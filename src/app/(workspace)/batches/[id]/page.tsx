"use client";
import { use, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Bootstrap } from "@/lib/client/types";
import { BatchReview } from "@/components/BatchReview";
import { ErrorState, PageLoading } from "@/components/ui";
export default function BatchPage({params}:{params:Promise<{id:string}>}) {
  const {id}=use(params);const [bootstrap,setBootstrap]=useState<Bootstrap|null>(null),[error,setError]=useState("");
  useEffect(()=>{api.get<Bootstrap>("/api/bootstrap?scope=context").then(setBootstrap).catch(e=>setError(e.message));},[]);
  return error?<ErrorState message={error} onRetry={()=>window.location.reload()}/>:bootstrap?<BatchReview key={id} id={id} bootstrap={bootstrap}/>:<PageLoading/>;
}
