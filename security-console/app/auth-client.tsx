"use client";
import { consolePath } from "../lib/paths";

import { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || "Request failed"); return data;
}
export function PasswordLogin() {
  const router=useRouter();
  const [message,setMessage]=useState("");
  return <form className="form" onSubmit={async e=>{e.preventDefault();setMessage("");const password=String(new FormData(e.currentTarget).get("password")||"");try{const data=await post(consolePath("/api/auth/login"),{password});router.push(data.next)}catch(error){setMessage(error instanceof Error?error.message:"Login failed")}}}>
    <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><button>Continue to passkey</button>{message&&<p className="danger" role="alert">{message}</p>}
  </form>;
}
export function SetupForm() {
  const router=useRouter();
  const [message,setMessage]=useState("");
  return <form className="form" onSubmit={async e=>{e.preventDefault();setMessage("");const form=new FormData(e.currentTarget);try{const data=await post(consolePath("/api/auth/setup"),{bootstrapToken:form.get("token"),password:form.get("password")});router.push(data.next)}catch(error){setMessage(error instanceof Error?error.message:"Setup failed")}}}>
    <label>One-time bootstrap token<input name="token" type="password" autoComplete="off" required/></label><label>New security console password<input name="password" type="password" autoComplete="new-password" minLength={16} maxLength={128} required/></label><p className="muted">Use at least 16 characters with uppercase, lowercase, number, and symbol.</p><button>Initialize console</button>{message&&<p className="danger" role="alert">{message}</p>}
  </form>;
}
export function PasskeyLogin() {
  const router=useRouter();
  const [message,setMessage]=useState("");
  return <button onClick={async()=>{setMessage("");try{const {options}=await post(consolePath("/api/auth/passkeys"),{action:"authentication-options"});const response=await startAuthentication({optionsJSON:options});await post(consolePath("/api/auth/passkeys"),{action:"authenticate",response});router.push(consolePath("/"))}catch(error){setMessage(error instanceof Error?error.message:"Passkey failed")}}}>Use security passkey{message&&<span className="danger"> {message}</span>}</button>;
}
type Passkey={id:string;name:string;deviceType:string;backedUp:boolean};
export function PasskeyManager() {
  const [items,setItems]=useState<Passkey[]>([]);const [message,setMessage]=useState("");
  const load=()=>fetch(consolePath("/api/auth/passkeys"),{cache:"no-store"}).then(r=>r.json()).then(d=>setItems(d.passkeys||[])); useEffect(()=>{void load()},[]);
  return <div><button onClick={async()=>{setMessage("");try{const name=prompt("Passkey name")||"Security passkey";const {options}=await post(consolePath("/api/auth/passkeys"),{action:"registration-options"});const response=await startRegistration({optionsJSON:options});await post(consolePath("/api/auth/passkeys"),{action:"register",response,name});await load()}catch(error){setMessage(error instanceof Error?error.message:"Enrollment failed")}}}>Add passkey</button>{message&&<p className="danger">{message}</p>}<div className="events">{items.map(item=><div className="panel event" key={item.id}><span><strong>{item.name}</strong><br/><span className="muted">{item.deviceType} · {item.backedUp?"backed up":"device bound"}</span></span><button onClick={async()=>{const response=await fetch(consolePath(`/api/auth/passkeys?id=${encodeURIComponent(item.id)}`),{method:"DELETE"});const data=await response.json();if(!response.ok)setMessage(data.reason||data.error);else await load()}}>Remove</button></div>)}</div></div>;
}
export function LogoutButton(){const router=useRouter();return <button className="link-button" onClick={async()=>{await fetch(consolePath("/api/auth/logout"),{method:"POST"});router.push(consolePath("/login"))}}>Log out</button>}
export function DeliveryTest(){const[message,setMessage]=useState("");return <div><button onClick={async()=>{setMessage("Testing…");try{const response=await fetch(consolePath("/api/delivery-test"),{method:"POST"});const data=await response.json();setMessage(response.ok?`Provider HTTP ${data.httpStatus}; reference ${data.reference}`:(data.error||"Test failed"))}catch{setMessage("Test failed")}}}>Run controlled delivery test</button>{message&&<p className="muted" role="status">{message}</p>}</div>}
