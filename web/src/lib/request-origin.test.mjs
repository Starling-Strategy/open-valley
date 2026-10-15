import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRequestOrigin } from './request-origin.mjs';

const primary='https://rockefeller.tail7a94dc.ts.net:10016';
const tunnels='http://127.0.0.1:13460,http://localhost:13460';
const request=(origin,extra={})=>new Request('http://127.0.0.1:3460/api/ask',{headers:{...(origin===undefined?{}:{Origin:origin}),...extra}});

test('explicit tunnel origins work when Next sees the backend listener URL',()=>{
  for(const origin of [undefined,primary,'http://127.0.0.1:3460','http://127.0.0.1:13460','http://localhost:13460']) {
    assert.equal(isAllowedRequestOrigin(request(origin),primary,tunnels),true,origin);
  }
});

test('unconfigured origins and spoofed forwarding headers stay blocked',()=>{
  for(const origin of ['null','https://example.org','http://127.0.0.1:9999','http://localhost:13461','http://127.0.0.1:13460.example.org','http://127.0.0.1:13460/']) {
    assert.equal(isAllowedRequestOrigin(request(origin,{Host:'example.org','X-Forwarded-Host':'example.org','X-Forwarded-Proto':'https'}),primary,tunnels),false,origin);
  }
  assert.equal(isAllowedRequestOrigin(request('http://127.0.0.1:13460'),primary,''),false);
});
