import {test} from 'node:test';import assert from 'node:assert/strict';import {ingress} from '../ingress.mjs';
const token='fixture-proxy-'+'x'.repeat(48),origin='https://panel.example.test:13443';
const req=(host,secret,ip='127.0.0.1')=>({headers:{host,'x-doubao-proxy-token':secret},socket:{remoteAddress:ip}});
test('默认保持严格本机入口，不因转发头放宽 Host',()=>{
 const g=ingress({port:43862});assert.equal(g.remote,false);assert.equal(g.origin,'http://127.0.0.1:43862');assert(g.accepts(req('127.0.0.1:43862')));assert(!g.accepts(req('panel.example.test')));
});
test('云端入口同时检查精确 Host、回环代理和私有代理凭据',()=>{
 const g=ingress({port:43862,publicOrigin:origin,proxyToken:token});assert(g.remote);assert(g.accepts(req('panel.example.test:13443',token)));assert(!g.accepts(req('panel.example.test:13443')));assert(!g.accepts(req('panel.example.test:13443','incorrect')));assert(!g.accepts(req('panel.example.test:13443',token,'198.51.100.2')));assert(!g.accepts(req('127.0.0.1:43862',token)));
});
test('云端配置缺少 HTTPS 或代理凭据时停止，不隐式暴露管理接口',()=>{
 for(const value of ['http://panel.example.test','https://x:pass@panel.example.test','https://panel.example.test/path','https://panel.example.test/','https://panel.example.test?x=1'])assert.throws(()=>ingress({port:43862,publicOrigin:value,proxyToken:token}));
 assert.throws(()=>ingress({port:43862,publicOrigin:origin}));assert.throws(()=>ingress({port:43862,proxyToken:token}));
});
