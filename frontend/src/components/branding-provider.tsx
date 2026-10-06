'use client';
import { createContext,useContext,useEffect,useState } from 'react';
const API_URL=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api';
export type Branding={company_name:string;tagline:string;logo_url?:string|null;favicon_url?:string|null};
const fallback:Branding={company_name:'Errances Voyages',tagline:'Travels CRM'};
const Context=createContext<Branding>(fallback);
export function BrandingProvider({children}:{children:React.ReactNode}){const [brand,setBrand]=useState(fallback);useEffect(()=>{fetch(`${API_URL}/settings/company/public`).then(r=>r.ok?r.json():null).then(v=>v&&setBrand(v)).catch(()=>{});},[]);useEffect(()=>{document.title=`${brand.company_name} — CRM`;if(brand.favicon_url||brand.logo_url){let link=document.querySelector("link[rel~='icon']") as HTMLLinkElement|null;if(!link){link=document.createElement('link');link.rel='icon';document.head.appendChild(link);}link.href=brand.favicon_url||brand.logo_url!;}},[brand]);return <Context.Provider value={brand}>{children}</Context.Provider>}
export const useBranding=()=>useContext(Context);
