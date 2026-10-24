// Security regressions use real WebAuthn verification and Lua with synthetic local providers.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string,string>, cookie: '', revokeAtCommit: false, revokeAfterInitialCommit: false, get: vi.fn(), put: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => state.cookie ? {value:state.cookie} : undefined }) }));
vi.mock('@/lib/redis', () => ({ getRedis: () => ({
 get: async (key:string) => {const raw=state.store[key];if(raw===undefined)return null;try{return JSON.parse(raw)}catch{return raw}},
 set: async (key:string,value:unknown,options?:{nx?:boolean}) => {if(options?.nx&&key in state.store)return null;state.store[key]=typeof value==='string'?value:JSON.stringify(value);return 'OK'},
 del: async (key:string) => {delete state.store[key];return 1},
 eval: async (script:string,keys:string[],args:unknown[]) => {
  if(state.revokeAtCommit&&keys[0]==='speedzone:admin:passkeys') {delete state.store[sessionKey(state.cookie)];state.revokeAtCommit=false;}
  const result=JSON.parse(execFileSync('python3',[resolve('tests/helpers/security-lua.py')],{input:JSON.stringify({script,keys,args,store:state.store}),encoding:'utf8'}));state.store=result.store;if(state.revokeAfterInitialCommit&&args[3]==='initial'&&result.result===1){state.store['speedzone:admin-session-generation']='revoked-after-commit';state.revokeAfterInitialCommit=false;}return result.result;
 }
}) }));
vi.mock('@vercel/blob',async original => ({...await original<typeof import('@vercel/blob')>(),get:state.get,put:state.put,list:state.list,del:state.del}));
vi.mock('@/lib/diagnostics',()=>({withDiagnostics:(_op:string,fn:()=>Promise<Response>)=>fn()}));
vi.mock('@/lib/security-events',()=>({securityRequestContext:()=>({}),writeSecurityEvent:async()=>{},auditRoute:async(_r:Request,_e:string,f:()=>Promise<Response>)=>f()}));
import { createAdminSession, isAdminAuthenticated, isValidAdminSession } from '@/lib/admin-auth';
import { credentialActionOptions, verifyCredentialAction, registrationOptions } from '@/lib/admin-passkeys';
import { POST as passkey } from '@/app/api/admin/passkey/route';
import { GET as inbox } from '@/app/api/admin/test-drives/route';
import { POST as cleanup } from '@/app/api/admin/blob-cleanup/route';
import { POST as inventoryCreate } from '@/app/api/inventory/route';
import { readInventorySnapshot, writeInventory } from '@/lib/inventory';
import { inventoryStateKey, inventoryPhotoStateKey } from '@/lib/inventory-state';
const config={rpID:'speedzonems.com',origin:'https://admin-inventory.speedzonems.com'};
function sessionKey(token:string){return `speedzone:admin-session:${createHash('sha256').update(token).digest('hex')}`}
function request(path:string,body?:unknown,extra:Record<string,string>={}){return new Request(`https://admin-inventory.speedzonems.com${path}`,{method:body?'POST':'GET',headers:{cookie:`speedzone_admin=${state.cookie}`,'content-type':'application/json',origin:config.origin,...extra},...(body?{body:JSON.stringify(body)}:{})})}
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const jwk=pair.publicKey.export({format:'jwk'});
const cose=Buffer.concat([Buffer.from([0xa5,1,2,3,0x26,0x20,1,0x21,0x58,0x20]),Buffer.from(jwk.x!,'base64url'),Buffer.from([0x22,0x58,0x20]),Buffer.from(jwk.y!,'base64url')]);
async function registration(){
 const result=await registrationOptions(config, request('/api/admin/passkey'));expect('options' in result).toBe(true);const options=(result as {options:{challenge:string}}).options;
 const id=Buffer.from('audit-new-key').toString('base64url');const idBytes=Buffer.from(id,'base64url');const length=Buffer.alloc(2);length.writeUInt16BE(idBytes.length);
 const clientData=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin:config.origin}));
 const authData=Buffer.concat([createHash('sha256').update(config.rpID).digest(),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),length,idBytes,cose]);
 const attestation=Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746158','hex'),Buffer.from([authData.length]),authData]);
 return {id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientData.toString('base64url'),attestationObject:attestation.toString('base64url'),transports:['internal']}};
}
const photo='https://auditstore.public.blob.vercel-storage.com/inventory/photos/audit.webp';
const vehicle={id:'one',year:2022,make:'Honda',model:'Civic',price:100,mileage:1,condition:'Used',description:'',status:'available' as const,photos:[],createdAt:'2026-01-01'};
beforeEach(()=>{vi.clearAllMocks();state.cookie='';state.revokeAtCommit=false;state.revokeAfterInitialCommit=false;state.store={'speedzone:admin-credential-epoch':'1','speedzone:admin-session-generation':'audit-generation',[inventoryStateKey]:JSON.stringify({version:2,revision:'v1',vehicles:[vehicle]})};vi.stubEnv('WEBAUTHN_RP_ID',config.rpID);vi.stubEnv('WEBAUTHN_ORIGIN',config.origin);vi.stubEnv('BLOB_READ_WRITE_TOKEN','vercel_blob_rw_auditstore_SYNTHETIC');vi.stubEnv('TEST_DRIVE_BLOB_READ_WRITE_TOKEN','SYNTHETIC');state.get.mockImplementation(async()=>({statusCode:200,blob:{etag:'v1'},stream:new Response(JSON.stringify([vehicle])).body}));state.list.mockResolvedValue({blobs:[],hasMore:false});state.put.mockResolvedValue({etag:'v2'});state.del.mockResolvedValue(undefined)});

const establishedId = Buffer.from('audit-established-key').toString('base64url');
async function signIn() {
  state.cookie = (await createAdminSession(1, 'passkey'))!;
  state.store['speedzone:admin:passkeys'] = JSON.stringify([{id:establishedId,publicKey:cose.toString('base64url'),counter:0,credentialEpoch:1}]);
}
async function authorize(action: 'add'|'delete', target='') {
  const result = await credentialActionOptions(request('/api/admin/passkey'), config, action, target);
  if (!('options' in result) || !result.options) throw new Error('Missing assertion options');
  const clientData = Buffer.from(JSON.stringify({type:'webauthn.get',challenge:result.options.challenge,origin:config.origin}));
  const counter = Buffer.alloc(4); counter.writeUInt32BE(JSON.parse(state.store['speedzone:admin:passkeys']!).find((key:{id:string})=>key.id===establishedId).counter+1);
  const authenticatorData = Buffer.concat([createHash('sha256').update(config.rpID).digest(),Buffer.from([5]),counter]);
  const signature = sign('sha256',Buffer.concat([authenticatorData,createHash('sha256').update(clientData).digest()]),pair.privateKey);
  const response = {id:establishedId,rawId:establishedId,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientData.toString('base64url'),authenticatorData:authenticatorData.toString('base64url'),signature:signature.toString('base64url')}};
  const verified = await verifyCredentialAction(request('/api/admin/passkey'),response,config,action,target);
  if (!('grant' in verified)) throw new Error('Fresh assertion failed');
  return verified.grant;
}
it('consumes setup authorization and blocks private data until enrollment completes',async()=>{
  state.cookie=(await createAdminSession(1,'setup'))!; const old=state.cookie;
  expect((await inbox(request('/api/admin/test-drives'))).status).toBe(401);
  const response=await passkey(request('/api/admin/passkey',{action:'register',response:await registration()}));
  expect(response.status).toBe(200);expect(state.store[sessionKey(old)]).toBeUndefined();expect(await isAdminAuthenticated()).toBe(false);
  state.cookie=response.headers.get('set-cookie')!.split(';')[0]!.split('=')[1]!;
  expect(await isValidAdminSession(state.cookie)).toBe(true);expect((await inbox(request('/api/admin/test-drives'))).status).toBe(200);
});
it('expires setup privileges after five minutes',async()=>{
  state.cookie=(await createAdminSession(1,'setup'))!;
  const key=sessionKey(state.cookie), session=JSON.parse(state.store[key]!); session.createdAt=Date.now()-300001;state.store[key]=JSON.stringify(session);
  expect(await registrationOptions(config,request('/api/admin/passkey'))).toHaveProperty('error');
});
it('revocation after initial enrollment cannot mint a session in the replacement generation',async()=>{
  state.cookie=(await createAdminSession(1,'setup'))!;const response=await registration();state.revokeAfterInitialCommit=true;
  const registered=await passkey(request('/api/admin/passkey',{action:'register',response}));
  expect(registered.status).toBe(503);expect(registered.headers.get('set-cookie')).toBeNull();
  expect(await isAdminAuthenticated()).toBe(false);expect(JSON.parse(state.store['speedzone:admin:passkeys']!)).toHaveLength(1);
});
it('passkey removal does not block enrollment from the retained session',async()=>{
  await signIn();state.store['speedzone:admin:passkeys']=JSON.stringify([...JSON.parse(state.store['speedzone:admin:passkeys']!),{id:'backup',publicKey:cose.toString('base64url'),counter:0,credentialEpoch:1}]);
  const proof=await registration();const deleteGrant=await authorize('delete','backup');
  expect((await passkey(request('/api/admin/passkey',{action:'delete',id:'backup',grant:deleteGrant}))).status).toBe(200);
  expect(await isAdminAuthenticated()).toBe(true);
  // Enrollment is session-authorized now: removing a key does not invalidate
  // the retained session's ability to enroll a replacement.
  expect((await passkey(request('/api/admin/passkey',{action:'register',response:proof}))).status).toBe(200);
  expect(JSON.parse(state.store['speedzone:admin:passkeys']!)).toHaveLength(2);
});
it('a stolen session alone can enroll a key but cannot delete one',async()=>{
  await signIn();
  expect((await passkey(request('/api/admin/passkey',{action:'registration-options'}))).status).toBe(200);
  expect((await passkey(request('/api/admin/passkey',{action:'delete',id:establishedId}))).status).toBe(400);
  expect(JSON.parse(state.store['speedzone:admin:passkeys']!)).toHaveLength(1);
});
it('a registration challenge authorizes exactly one addition',async()=>{
  await signIn();const proof=await registration();
  const registered=await passkey(request('/api/admin/passkey',{action:'register',response:proof}));
  expect(registered.status).toBe(200);expect(registered.headers.get('set-cookie')).toBeNull();
  expect(JSON.parse(state.store['speedzone:admin:passkeys']!)).toHaveLength(2);
  expect((await passkey(request('/api/admin/passkey',{action:'register',response:proof}))).status).toBe(400);
});
it('revocation immediately before registration commit prevents enrollment and session creation',async()=>{
  await signIn();const proof=await registration();state.revokeAtCommit=true;
  const response=await passkey(request('/api/admin/passkey',{action:'register',response:proof}));
  expect(response.status).toBe(400);expect(response.headers.get('set-cookie')).toBeNull();expect(JSON.parse(state.store['speedzone:admin:passkeys']!)).toHaveLength(1);
});
it('a target-bound removal consumes its grant and revokes other sessions',async()=>{
  await signIn();const current=state.cookie;const other=(await createAdminSession(1,'passkey'))!;state.cookie=current;
  state.store['speedzone:admin:passkeys']=JSON.stringify([...JSON.parse(state.store['speedzone:admin:passkeys']!),{id:'backup',publicKey:cose.toString('base64url'),counter:0,credentialEpoch:1}]);
  const grant=await authorize('delete','backup');
  expect((await passkey(request('/api/admin/passkey',{action:'delete',id:'backup',grant}))).status).toBe(200);
  expect(await isValidAdminSession(current)).toBe(true);expect(await isValidAdminSession(other)).toBe(false);
  expect((await passkey(request('/api/admin/passkey',{action:'delete',id:establishedId,grant}))).status).toBe(400);
  expect(JSON.parse(state.store['speedzone:admin:passkeys']!)).toHaveLength(1);
});
it('rejects sibling-origin simple requests before cleanup',async()=>{
  await signIn();state.list.mockResolvedValue({blobs:[{url:photo,size:100,uploadedAt:new Date(0)}]});
  const response=await cleanup(request('/api/admin/blob-cleanup',{confirm:true},{'content-type':'text/plain',origin:'https://www.speedzonems.com','sec-fetch-site':'same-site'}));
  expect(response.status).toBe(403);expect(state.del).not.toHaveBeenCalled();
});
it('does not combine a stale CDN body with a fresh revision',async()=>{
  await signIn();state.store[inventoryStateKey]=JSON.stringify({version:2,revision:'v2',vehicles:[vehicle,{...vehicle,id:'recent'}]});
  expect((await inventoryCreate(request('/api/inventory',{vehicle,photos:[]},{'if-match':'v2'}))).status).toBe(201);
  expect(JSON.parse(state.store[inventoryStateKey]!).vehicles.some((v:{id:string})=>v.id==='recent')).toBe(true);expect(state.get).not.toHaveBeenCalled();
});
it('does not delete fresh uploads or older photos with an active upload lease',async()=>{
  await signIn();state.list.mockResolvedValue({blobs:[{url:photo,size:100,uploadedAt:new Date()}]});
  expect((await cleanup(request('/api/admin/blob-cleanup',{confirm:true}))).status).toBe(200);expect(state.del).not.toHaveBeenCalled();
  state.list.mockResolvedValue({blobs:[{url:photo,size:100,uploadedAt:new Date(0)}]});state.store[inventoryPhotoStateKey(photo)]='uploading';
  expect((await cleanup(request('/api/admin/blob-cleanup',{confirm:true}))).status).toBe(200);expect(state.del).not.toHaveBeenCalled();
});
it('deletion claims block later attachment in the actual catalog commit',async()=>{
  await signIn();state.list.mockResolvedValue({blobs:[{url:photo,size:100,uploadedAt:new Date(0)}]});
  expect((await cleanup(request('/api/admin/blob-cleanup',{confirm:true}))).status).toBe(200);expect(state.del).toHaveBeenCalledWith([photo]);
  const snapshot=await readInventorySnapshot();await expect(writeInventory([{...vehicle,photos:[photo]}],snapshot.revision)).rejects.toThrow('no longer available');
  expect(JSON.parse(state.store[inventoryStateKey]!).vehicles[0].photos).toEqual([]);
});
