"use client";
import { consolePath } from "../lib/paths";

import { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || "Request failed"); return data;
}
export function PasswordLogin() {
  const [message,setMessage]=useState("");
  return <form className="form" onSubmit={async e=>{e.preventDefault();setMessage("");const password=String(new FormData(e.currentTarget).get("password")||"");try{await post(consolePath("/api/auth/login"),{password});window.location.replace(consolePath("/login/passkey"))}catch(error){setMessage(error instanceof Error?error.message:"Login failed")}}}>
    <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><button>Continue to passkey</button>{message&&<p className="danger" role="alert">{message}</p>}
  </form>;
}
export function PasskeyLogin() {
  const [message,setMessage]=useState("");
  return <button onClick={async()=>{setMessage("");try{const {options}=await post(consolePath("/api/auth/passkeys"),{action:"authentication-options"});const response=await startAuthentication({optionsJSON:options});await post(consolePath("/api/auth/passkeys"),{action:"authenticate",response});window.location.replace(consolePath("/"))}catch(error){setMessage(error instanceof Error?error.message:"Passkey failed")}}}>Use security passkey{message&&<span className="danger"> {message}</span>}</button>;
}
type Passkey={id:string;name:string;deviceType:string;backedUp:boolean};
export function PasskeyManager() {
  const [items,setItems]=useState<Passkey[]>([]);const [message,setMessage]=useState("");
  const load=()=>fetch(consolePath("/api/auth/passkeys"),{cache:"no-store"}).then(r=>r.json()).then(d=>setItems(d.passkeys||[])); useEffect(()=>{void load()},[]);
  return <div><button onClick={async()=>{setMessage("");try{const name=prompt("Passkey name")||"Security passkey";const {options}=await post(consolePath("/api/auth/passkeys"),{action:"registration-options"});const response=await startRegistration({optionsJSON:options});await post(consolePath("/api/auth/passkeys"),{action:"register",response,name});await load()}catch(error){setMessage(error instanceof Error?error.message:"Enrollment failed")}}}>Add passkey</button>{message&&<p className="danger">{message}</p>}<div className="events">{items.map(item=><div className="panel event" key={item.id}><span><strong>{item.name}</strong><br/><span className="muted">{item.deviceType} · {item.backedUp?"backed up":"device bound"}</span></span><button onClick={async()=>{const response=await fetch(consolePath(`/api/auth/passkeys?id=${encodeURIComponent(item.id)}`),{method:"DELETE"});const data=await response.json();if(!response.ok)setMessage(data.reason||data.error);else await load()}}>Remove</button></div>)}</div></div>;
}
export function LogoutButton(){return <button className="link-button" onClick={async()=>{await fetch(consolePath("/api/auth/logout"),{method:"POST"});window.location.replace(consolePath("/login"))}}>Log out</button>}
export function DeliveryTest(){const[message,setMessage]=useState("");return <div><button onClick={async()=>{setMessage("Testing…");try{const response=await fetch(consolePath("/api/delivery-test"),{method:"POST"});const data=await response.json();setMessage(response.ok?`Provider HTTP ${data.httpStatus}; reference ${data.reference}`:(data.error||"Test failed"))}catch{setMessage("Test failed")}}}>Run controlled delivery test</button>{message&&<p className="muted" role="status">{message}</p>}</div>}
