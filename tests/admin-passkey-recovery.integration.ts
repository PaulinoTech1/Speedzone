// Mailbox-compromise regressions: real Lua (via lupa) and real WebAuthn verification, synthetic local state only.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: {} as Record<string,string>, cookie: '', revokeAtCommit: false, revokeAfterInitialCommit: false, get: vi.fn(), put: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => state.cookie ? {value:state.cookie} : undefined, set: (_n:string,v:string)=>{state.cookie=v;}, delete: ()=>{} }) }));
vi.mock('@/lib/admin-login-rate-limit',()=>({checkAdminLoginRateLimit:async()=>({configured:true,success:true,retryAfter:0})}));
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
import { createAdminSession, isValidAdminSession } from '@/lib/admin-auth';
import { credentialActionOptions, verifyCredentialAction, registrationOptions } from '@/lib/admin-passkeys';
import { POST as passkey } from '@/app/api/admin/passkey/route';
import { GET as inbox } from '@/app/api/admin/test-drives/route';
import { inventoryStateKey } from '@/lib/inventory-state';
import argon2 from 'argon2';
import { POST as login } from '@/app/api/admin/login/route';
import { POST as resetPassword } from '@/app/api/admin/recovery/reset/route';
import { POST as schedulePasskeyReset } from '@/app/api/admin/recovery/passkey-reset/route';
import { createRecoveryToken } from '@/lib/admin-recovery';
const config={rpID:'speedzonems.com',origin:'https://admin-inventory.speedzonems.com'};
function sessionKey(token:string){return `speedzone:admin-session:${createHash('sha256').update(token).digest('hex')}`}
function request(path:string,body?:unknown,extra:Record<string,string>={}){return new Request(`https://admin-inventory.speedzonems.com${path}`,{method:body?'POST':'GET',headers:{cookie:`speedzone_admin=${state.cookie}`,'content-type':'application/json',origin:config.origin,...extra},...(body?{body:JSON.stringify(body)}:{})})}
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const jwk=pair.publicKey.export({format:'jwk'});
const cose=Buffer.concat([Buffer.from([0xa5,1,2,3,0x26,0x20,1,0x21,0x58,0x20]),Buffer.from(jwk.x!,'base64url'),Buffer.from([0x22,0x58,0x20]),Buffer.from(jwk.y!,'base64url')]);
async function registration(grant?:string){
 const result=await registrationOptions(config, request('/api/admin/passkey'),grant);expect('options' in result).toBe(true);const options=(result as {options:{challenge:string}}).options;
 const id=Buffer.from('audit-new-key').toString('base64url');const idBytes=Buffer.from(id,'base64url');const length=Buffer.alloc(2);length.writeUInt16BE(idBytes.length);
 const clientData=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin:config.origin}));
 const authData=Buffer.concat([createHash('sha256').update(config.rpID).digest(),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),length,idBytes,cose]);
 const attestation=Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746158','hex'),Buffer.from([authData.length]),authData]);
 return {id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientData.toString('base64url'),attestationObject:attestation.toString('base64url'),transports:['internal']}};
}
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

const PASSKEYS='speedzone:admin:passkeys', EPOCH='speedzone:admin-credential-epoch', PENDING='speedzone:admin:passkey-reset', REENROLL='speedzone:admin:passkey-reenroll';
const original='Original-admin-password-42', attacker='Attacker-chosen-password-42';
async function withPassword(password=original){state.store['speedzone:admin-credential:v2']=await argon2.hash(password,{type:argon2.argon2id});state.store['speedzone:admin-credential-state:v1']='initialized';}
async function passwordLogin(password:string){state.cookie='';return login(request('/api/admin/login',{password}));}
const keys=()=>JSON.parse(state.store[PASSKEYS]??'[]') as {id:string;credentialEpoch:number}[];
async function mailboxReset(password=attacker){const token=(await createRecoveryToken())!;expect(token).toBeTruthy();
  const response=await resetPassword(request('/api/admin/recovery/reset',{token,password,operationId:crypto.randomUUID()}));expect(response.status).toBe(200);}
async function enrollWithCodes(){await signIn();const grant=await authorize('add');const registered=await passkey(request('/api/admin/passkey',{action:'register',response:await registration(grant),grant}));
  expect(registered.status).toBe(200);const {recoveryCodes}=await registered.json();expect(recoveryCodes).toHaveLength(10);return recoveryCodes as string[];}

it('mailbox-only: a password reset keeps every passkey current, but password login now signs in',async()=>{
  await withPassword();await signIn();const priorSession=state.cookie;
  await mailboxReset();
  expect(state.store[EPOCH]).toBe('1');expect(keys()).toHaveLength(1);expect(keys()[0]!.credentialEpoch).toBe(1);
  expect(await isValidAdminSession(priorSession)).toBe(false); // reset still signs out all sessions
  // A passkey is no longer required: the reset password signs in with a full
  // session. Adding a key from it still needs a fresh assertion from an
  // established key, which the mailbox-only attacker does not have.
  const response=await passwordLogin(attacker);expect(response.status).toBe(200);expect(state.cookie).toBeTruthy();
  expect(await registrationOptions(config,request('/api/admin/passkey'))).toHaveProperty('error','Verify an established passkey before adding a key');
  expect((await inbox(request('/api/admin/test-drives'))).status).toBe(200);
});
it('mailbox-only: stale (retired-epoch) passkeys no longer block password sign-in, and still cannot be enrolled from a setup session',async()=>{
  await withPassword(attacker);state.store[PASSKEYS]=JSON.stringify([{id:establishedId,publicKey:cose.toString('base64url'),counter:0,credentialEpoch:0}]);
  expect((await passwordLogin(attacker)).status).toBe(200);
  state.cookie=(await createAdminSession(1,'setup'))!; // even a forged setup session cannot enroll
  expect(await registrationOptions(config,request('/api/admin/passkey'))).toHaveProperty('error');
});
it('mailbox-only: a recovery link without a valid recovery code cannot schedule a reset, and the link is burned',async()=>{
  await withPassword();await enrollWithCodes();state.cookie='';
  const token=(await createRecoveryToken())!;
  const response=await schedulePasskeyReset(request('/api/admin/recovery/passkey-reset',{token,recoveryCode:'AAAAA-BBBBB-CCCCC-DDDDD'}));
  expect(response.status).toBe(400);expect(state.store[PENDING]).toBeUndefined();
  const real=await schedulePasskeyReset(request('/api/admin/recovery/passkey-reset',{token,recoveryCode:'AAAAA-BBBBB-CCCCC-DDDDD'}));
  expect(real.status).toBe(400);
});
it('mailbox-only: a recovery code without the emailed link cannot schedule a reset',async()=>{
  await withPassword();const [code]=await enrollWithCodes();state.cookie='';
  const response=await schedulePasskeyReset(request('/api/admin/recovery/passkey-reset',{token:'x'.repeat(43),recoveryCode:code}));
  expect(response.status).toBe(400);expect(state.store[PENDING]).toBeUndefined();
});
it('link + code schedules a 48h reset that a passkey session can cancel; nothing is retired early',async()=>{
  await withPassword();const [code]=await enrollWithCodes();const owner=state.cookie;state.cookie='';
  const token=(await createRecoveryToken())!;
  const scheduled=await schedulePasskeyReset(request('/api/admin/recovery/passkey-reset',{token,recoveryCode:code}));
  expect(scheduled.status).toBe(202);const executeAt=Date.parse((await scheduled.json()).executeAt);expect(executeAt-Date.now()).toBeGreaterThan(47.9*3600_000);
  await mailboxReset();expect((await passwordLogin(attacker)).status).toBe(200);expect(keys()).toHaveLength(2);
  // Code is single-use.
  const again=await schedulePasskeyReset(request('/api/admin/recovery/passkey-reset',{token:(await createRecoveryToken())!,recoveryCode:code}));expect(again.status).toBe(409);
  state.cookie=(await createAdminSession(1,'passkey'))!;void owner;
  const status=await passkey(request('/api/admin/passkey',{action:'recovery-status'}));expect((await status.json()).pendingReset).not.toBeNull();
  const cancelled=await passkey(request('/api/admin/passkey',{action:'cancel-recovery'}));expect(await cancelled.json()).toEqual({cancelled:true});
  expect(state.store[PENDING]).toBeUndefined();
  const p=JSON.parse(state.store[PENDING]??'null');expect(p).toBeNull();
});
it('cancel requires a passkey session',async()=>{
  state.store[PENDING]=JSON.stringify({version:1,requestedAt:0,executeAt:Date.now()+1000});
  state.cookie=(await createAdminSession(1,'setup'))!;
  expect((await passkey(request('/api/admin/passkey',{action:'cancel-recovery'}))).status).toBe(401);expect(state.store[PENDING]).toBeDefined();
});
it('after the waiting period, password + elapsed reset retires all keys and permits exactly one new enrollment',async()=>{
  await withPassword();const [code,second]=await enrollWithCodes();state.cookie='';
  const scheduled=await schedulePasskeyReset(request('/api/admin/recovery/passkey-reset',{token:(await createRecoveryToken())!,recoveryCode:code}));expect(scheduled.status).toBe(202);
  const pending=JSON.parse(state.store[PENDING]!);pending.executeAt=Date.now()-1;state.store[PENDING]=JSON.stringify(pending);
  expect((await passwordLogin('wrong-password-123')).status).toBe(401);expect(keys()).toHaveLength(2); // wrong password does not execute
  const response=await passwordLogin(original);expect(response.status).toBe(200);
  expect(state.store[PASSKEYS]).toBeUndefined();expect(state.store[PENDING]).toBeUndefined();expect(state.store[REENROLL]).toBeDefined();
  const registered=await passkey(request('/api/admin/passkey',{action:'register',response:await registration()}));expect(registered.status).toBe(200);
  expect(state.store[REENROLL]).toBeUndefined();expect(keys()).toHaveLength(1);
  // The flag is consumed; a later password sign-in now opens a full session
  // (the passkey is no longer required), it is not refused.
  expect((await passwordLogin(original)).status).toBe(200);
  const old=await schedulePasskeyReset(request('/api/admin/recovery/passkey-reset',{token:(await createRecoveryToken())!,recoveryCode:second}));expect(old.status).toBe(400);
});
it('fresh installs still allow password bootstrap enrollment',async()=>{
  await withPassword();expect((await passwordLogin(original)).status).toBe(200);
  const registered=await passkey(request('/api/admin/passkey',{action:'register',response:await registration()}));expect(registered.status).toBe(200);
  expect((await registered.json()).recoveryCodes).toHaveLength(10);
});
