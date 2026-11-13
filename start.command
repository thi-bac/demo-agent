#!/bin/zsh
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
echo "Đang khởi động Minh An B2B Multi-Agent Server tại http://127.0.0.1:$PORT ..."
(sleep 1 && open "http://127.0.0.1:$PORT") &
exec ruby server.rb

