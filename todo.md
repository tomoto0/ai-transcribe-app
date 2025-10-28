# AI Transcribe App - TODO

## Project Overview
音声の転写、翻訳、サマリー生成を行うWebアプリケーション。
- Deepgram APIで音声を転写
- ManusのLLM機能で翻訳とサマリー生成を実行
- GitHubのプライベートリポジトリから移行

## Backend Implementation
- [x] LLM クライアント作成 (src/llm_client.py)
- [x] Gemini API → Manus LLM 置き換え
- [x] 依存関係更新 (openai ライブラリ追加)
- [x] Flask ルート移行 (audio_simple_improved.py → tRPC procedures)
- [x] 音声転写エンドポイント実装
- [x] 翻訳エンドポイント実装
- [x] サマリー生成エンドポイント実装
- [x] Deepgram API 統合確認

## Frontend Implementation
- [x] 音声録音UI実装 (React + Tailwind)
- [x] リアルタイム転写表示
- [x] 翻訳機UI
- [x] サマリー生成UI
- [x] セッション管理

## Database Schema
- [x] 音声セッション テーブル設計
- [x] 転写結果 テーブル設計
- [x] 翻訳履歴 テーブル設計

## Testing & Deployment
- [x] 認証機能削除 (ログイン不要)
- [x] Manus LLM機能統合修正 (翻訳・サマリーエラー)
- [ ] 機能テスト実行
- [ ] エラーハンドリング確認
- [ ] デプロイ前チェック
- [ ] チェックポイント作成

