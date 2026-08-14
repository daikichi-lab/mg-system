// Postgres の TLS 判定。
// Render の Internal Database URL は内部ホスト名（ドットなし）で、TLS を使うと
// 公的CAでは検証できず接続に失敗するため、内部ネットワークでは TLS を使わない。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pgSsl } from '../server/db.js'

test('Render の Internal Database URL（内部ホスト名）は TLS を使わない', () => {
  assert.equal(pgSsl('postgres://mg:pw@dpg-d9otlstbedkc73dmtrkg-a/mg_7zaj'), false)
  assert.equal(pgSsl('postgres://mg:pw@dpg-d9otlstbedkc73dmtrkg-a:5432/mg_7zaj'), false)
})

test('外部ホスト（FQDN）は証明書を検証する', () => {
  assert.equal(pgSsl('postgres://mg:pw@dpg-xxx-a.ohio-postgres.render.com/mg'), true)
  assert.equal(pgSsl('postgres://u:p@ep-cool-1.ap-southeast-1.aws.neon.tech/db'), true)
})

test('ローカルは TLS を使わない', () => {
  assert.equal(pgSsl('postgres://u:p@localhost:5432/db'), false)
  assert.equal(pgSsl('postgres://u:p@127.0.0.1:5432/db'), false)
})

test('sslmode の明示指定が優先される', () => {
  // 内部ホスト名でも require が付いていれば TLS を使う
  assert.equal(pgSsl('postgres://u:p@dpg-xxx-a/db?sslmode=require'), true)
  // 外部ホストでも disable なら使わない
  assert.equal(pgSsl('postgres://u:p@db.example.com/db?sslmode=disable'), false)
})

test('MG_PG_CA / MG_PG_INSECURE の指定が効く', () => {
  process.env.MG_PG_CA = '-----BEGIN CERTIFICATE-----'
  assert.deepEqual(pgSsl('postgres://u:p@db.example.com/db'), { ca: '-----BEGIN CERTIFICATE-----' })
  delete process.env.MG_PG_CA

  process.env.MG_PG_INSECURE = '1'
  assert.deepEqual(pgSsl('postgres://u:p@db.example.com/db'), { rejectUnauthorized: false })
  delete process.env.MG_PG_INSECURE
})
