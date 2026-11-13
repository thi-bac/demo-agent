#!/usr/bin/env ruby
# frozen_string_literal: true

require 'webrick'
require 'json'
require 'zlib'
require 'rexml/document'
require 'net/http'
require 'uri'
require 'cgi'
require 'base64'
require 'stringio'
require 'csv'

module MinhAnServer
  PORT = (ENV['PORT'] || 8765).to_i
  ROOT_DIR = File.expand_path(__dir__)
  PUBLIC_DIR = File.join(ROOT_DIR, 'public')
  SAMPLE_DIR = File.join(ROOT_DIR, 'sample_files')

  module XlsxParser
    module_function

    def col_ref_to_index(cell_ref)
      letters = cell_ref.to_s.gsub(/[^A-Za-z]/, '').upcase
      return 0 if letters.empty?

      idx = 0
      letters.each_char do |ch|
        idx = idx * 26 + (ch.ord - 'A'.ord + 1)
      end
      idx - 1
    end

    # Reads ZIP entries from binary string using Central Directory (handles data descriptors cleanly)
    def extract_zip_entries(binary)
      entries = {}
      data = binary.b
      eocd_sig = "PK\x05\x06".b
      eocd_pos = data.rindex(eocd_sig)
      raise 'File không phải định dạng ZIP/XLSX hợp lệ (thiếu EOCD).' unless eocd_pos

      cd_size, cd_offset = data[eocd_pos + 12, 8].unpack('VV')
      raise 'Cấu trúc Central Directory của XLSX không hợp lệ.' if cd_offset.nil? || cd_offset + cd_size > data.bytesize

      pos = cd_offset
      cd_end = cd_offset + cd_size
      cd_sig = "PK\x01\x02".b

      while pos < cd_end
        break unless data[pos, 4] == cd_sig

        method, comp_size, _uncomp_size, name_len, extra_len, comment_len =
          data[pos + 10, 2].unpack1('v'),
          *data[pos + 20, 8].unpack('VV'),
          *data[pos + 28, 6].unpack('vvv')
        local_offset = data[pos + 42, 4].unpack1('V')
        name = data[pos + 46, name_len].force_encoding('UTF-8')
        pos += 46 + name_len + extra_len + comment_len

        next unless data[local_offset, 4] == "PK\x03\x04".b

        l_name_len, l_extra_len = data[local_offset + 26, 4].unpack('vv')
        payload_offset = local_offset + 30 + l_name_len + l_extra_len
        compressed = data[payload_offset, comp_size]
        next if compressed.nil?

        content = case method
                  when 0
                    compressed
                  when 8
                    Zlib::Inflate.new(-Zlib::MAX_WBITS).inflate(compressed)
                  else
                    raise "Phương thức nén ZIP (#{method}) chưa được hỗ trợ."
                  end
        entries[name] = content.force_encoding('UTF-8')
      end

      entries
    end

    def parse_shared_strings(xml_str)
      return [] unless xml_str && !xml_str.empty?

      doc = REXML::Document.new(xml_str)
      strings = []
      REXML::XPath.each(doc, '//si') do |si|
        parts = []
        REXML::XPath.each(si, './/t') { |t| parts << (t.text || '') }
        strings << parts.join
      end
      strings
    end

    def parse_workbook_sheets(entries)
      wb_xml = entries['xl/workbook.xml']
      rels_xml = entries['xl/_rels/workbook.xml.rels']
      return [] unless wb_xml

      rels_map = {}
      if rels_xml
        rels_doc = REXML::Document.new(rels_xml)
        REXML::XPath.each(rels_doc, '//Relationship') do |rel|
          id = rel.attributes['Id']
          target = rel.attributes['Target'].to_s.sub(%r{^/}, '')
          target = "xl/#{target}" unless target.start_with?('xl/')
          rels_map[id] = target
        end
      end

      wb_doc = REXML::Document.new(wb_xml)
      sheets = []
      idx = 0
      REXML::XPath.each(wb_doc, '//sheet') do |sheet|
        idx += 1
        name = sheet.attributes['name'] || "Sheet#{idx}"
        r_id = sheet.attributes['r:id'] || sheet.attributes['id']
        path = rels_map[r_id] || "xl/worksheets/sheet#{idx}.xml"
        sheets << { name: name, path: path }
      end
      sheets
    end

    def parse_sheet_rows(xml_str, shared_strings)
      return [] unless xml_str && !xml_str.empty?

      doc = REXML::Document.new(xml_str)
      rows = []
      max_cols = 0

      REXML::XPath.each(doc, '//sheetData/row') do |row_el|
        row_cells = []
        REXML::XPath.each(row_el, './c') do |cell|
          ref = cell.attributes['r']
          col_idx = ref ? col_ref_to_index(ref) : row_cells.length
          while row_cells.length < col_idx
            row_cells << ''
          end

          cell_type = cell.attributes['t'].to_s
          val = ''
          if cell_type == 's'
            v_el = cell.elements['v']
            s_idx = v_el&.text.to_i
            val = shared_strings[s_idx] || ''
          elsif cell_type == 'inlineStr'
            parts = []
            REXML::XPath.each(cell, './/t') { |t| parts << (t.text || '') }
            val = parts.join
          elsif cell_type == 'b'
            v_el = cell.elements['v']
            val = v_el&.text == '1' ? 'TRUE' : 'FALSE'
          else
            v_el = cell.elements['v']
            val = v_el&.text.to_s
          end

          row_cells[col_idx] = val.strip
        end
        next if row_cells.all?(&:empty?)

        max_cols = row_cells.length if row_cells.length > max_cols
        rows << row_cells
      end

      rows.each do |r|
        r << '' while r.length < max_cols
      end
      rows
    end

    def parse(binary)
      entries = extract_zip_entries(binary)
      shared_strings = parse_shared_strings(entries['xl/sharedStrings.xml'])
      sheet_defs = parse_workbook_sheets(entries)

      if sheet_defs.empty?
        sheet_paths = entries.keys.select { |k| k =~ %r{^xl/worksheets/sheet\d+\.xml$} }.sort
        sheet_defs = sheet_paths.each_with_index.map { |p, i| { name: "Sheet#{i + 1}", path: p } }
      end

      sheet_defs.map do |sd|
        rows = parse_sheet_rows(entries[sd[:path]], shared_strings)
        { name: sd[:name], rows: rows }
      end
    end
  end

  module GoogleSheetFetcher
    module_function

    def parse_url(raw_url)
      uri = URI.parse(raw_url.strip)
      raise 'URL không hợp lệ.' unless uri.is_a?(URI::HTTP) || uri.is_a?(URI::HTTPS)
      unless uri.host&.include?('docs.google.com') || uri.host&.include?('sheets.google.com')
        raise 'Vui lòng nhập đường dẫn Google Sheets hợp lệ (docs.google.com/spreadsheets/...).'
      end

      match = uri.path.match(%r{/spreadsheets/(?:u/\d+/)?d/([a-zA-Z0-9_-]+)})
      raise 'Không tìm thấy Spreadsheet ID trong đường dẫn.' unless match

      sheet_id = match[1]
      gid = nil
      if uri.query
        params = CGI.parse(uri.query)
        gid = params['gid']&.first
      end
      if gid.nil? && uri.fragment
        frag_match = uri.fragment.match(/gid=(\d+)/)
        gid = frag_match[1] if frag_match
      end

      { sheet_id: sheet_id, gid: gid }
    end

    def http_get_with_redirects(url_str, limit = 6)
      raise 'Quá nhiều chuyển hướng khi tải Google Sheet.' if limit <= 0

      uri = URI.parse(url_str)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == 'https')
      http.open_timeout = 10
      http.read_timeout = 20

      req = Net::HTTP::Get.new(uri.request_uri)
      req['User-Agent'] = 'MinhAn-B2B-Agent/1.0'
      res = http.request(req)

      case res
      when Net::HTTPRedirection
        location = res['location']
        raise 'Google Sheet yêu cầu đăng nhập (chưa bật chia sẻ công khai).' if location&.include?('accounts.google.com')

        next_uri = URI.join(uri, location).to_s
        http_get_with_redirects(next_uri, limit - 1)
      when Net::HTTPSuccess
        res
      when Net::HTTPUnauthorized, Net::HTTPForbidden
        raise 'Không có quyền truy cập Google Sheet. Vui lòng bật chia sẻ: "Bất kỳ ai có đường liên kết đều có thể xem".'
      else
        raise "Lỗi tải Google Sheet (HTTP #{res.code})."
      end
    end

    def fetch(raw_url, mode = 'auto')
      info = parse_url(raw_url)
      sheet_id = info[:sheet_id]
      gid = info[:gid]

      use_csv = (mode == 'csv') || (mode == 'auto' && gid && !gid.empty?)
      if use_csv
        target_gid = gid && !gid.empty? ? gid : '0'
        export_url = "https://docs.google.com/spreadsheets/d/#{sheet_id}/export?format=csv&gid=#{target_gid}"
        res = http_get_with_redirects(export_url)
        body = res.body.force_encoding('UTF-8').sub(/\A\xEF\xBB\xBF/, '')
        if body.lstrip.start_with?('<!DOCTYPE', '<html')
          raise 'Google Sheet đang ở chế độ riêng tư hoặc link không hỗ trợ export CSV.'
        end

        rows = CSV.parse(body).map { |r| r.map { |c| c.to_s.strip } }.reject { |r| r.all?(&:empty?) }
        { source: 'google_sheet_csv', sheet_id: sheet_id, gid: target_gid, sheets: [{ name: "Sheet_gid_#{target_gid}", rows: rows }] }
      else
        export_url = "https://docs.google.com/spreadsheets/d/#{sheet_id}/export?format=xlsx"
        res = http_get_with_redirects(export_url)
        content_type = res['content-type'].to_s
        if content_type.include?('text/html')
          raise 'Google Sheet đang ở chế độ riêng tư. Hãy bật "Anyone with the link can view".'
        end

        sheets = XlsxParser.parse(res.body)
        { source: 'google_sheet_xlsx', sheet_id: sheet_id, sheets: sheets }
      end
    end
  end
end

def json_response(res, status, payload)
  res.status = status
  res['Content-Type'] = 'application/json; charset=utf-8'
  res['Access-Control-Allow-Origin'] = '*'
  res.body = JSON.generate(payload)
end

if __FILE__ == $PROGRAM_NAME
  server = WEBrick::HTTPServer.new(
    Port: MinhAnServer::PORT,
    BindAddress: '127.0.0.1',
    DocumentRoot: MinhAnServer::PUBLIC_DIR,
    Logger: WEBrick::Log.new($stderr, WEBrick::Log::INFO),
    AccessLog: []
  )

  server.mount_proc '/api/health' do |_req, res|
    json_response(res, 200, { ok: true, service: 'Minh An Multi-Agent B2B System', port: MinhAnServer::PORT })
  end

  server.mount_proc '/api/parse-xlsx' do |req, res|
    if req.request_method == 'OPTIONS'
      res.status = 204
      res['Access-Control-Allow-Origin'] = '*'
      res['Access-Control-Allow-Headers'] = 'Content-Type'
      next
    end

    begin
      body = req.body.to_s
      binary = if req.content_type.to_s.include?('application/json')
                 parsed = JSON.parse(body)
                 Base64.decode64(parsed.fetch('data'))
               else
                 body
               end
      sheets = MinhAnServer::XlsxParser.parse(binary)
      json_response(res, 200, { ok: true, sheets: sheets })
    rescue StandardError => e
      json_response(res, 400, { ok: false, error: e.message })
    end
  end

  server.mount_proc '/api/fetch-gsheet' do |req, res|
    if req.request_method == 'OPTIONS'
      res.status = 204
      res['Access-Control-Allow-Origin'] = '*'
      res['Access-Control-Allow-Headers'] = 'Content-Type'
      next
    end

    begin
      url = req.query['url']
      mode = req.query['mode'] || 'auto'
      raise 'Thiếu tham số url.' if url.nil? || url.strip.empty?

      result = MinhAnServer::GoogleSheetFetcher.fetch(url, mode)
      json_response(res, 200, { ok: true }.merge(result))
    rescue StandardError => e
      json_response(res, 400, { ok: false, error: e.message })
    end
  end

  server.mount('/sample_files', WEBrick::HTTPServlet::FileHandler, MinhAnServer::SAMPLE_DIR)

  trap('INT') { server.shutdown }
  trap('TERM') { server.shutdown }

  puts "Minh An Multi-Agent B2B Server running at http://127.0.0.1:#{MinhAnServer::PORT}"
  server.start
end

