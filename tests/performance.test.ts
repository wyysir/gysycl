import { describe, expect, it, vi } from "vitest";
import { concurrentMap } from "@/lib/client/concurrent-map";
import { createIngredientMatcher, suggestIngredients } from "@/server/master-data";
import { getReadyDb } from "@/lib/bootstrap";
import { createNameScorer, scoreName } from "@/lib/text";

describe("bounded uploads and batched matching", () => {
  it("overlaps uploads while preserving original page order", async () => {
    let active=0, peak=0;
    const result=await concurrentMap([30,5,1,2],2,async(ms,index)=>{
      active++; peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,ms)); active--; return index;
    });
    expect(result).toEqual([0,1,2,3]); expect(peak).toBe(2); expect(active).toBe(0);
  });
  it("drains running uploads after failure and does not start remaining pages", async () => {
    const started:number[]=[];let drained=false;
    await expect(concurrentMap([0,1,2,3,4],2,async(_,index)=>{
      started.push(index);
      if(index===0) {await new Promise(resolve=>setTimeout(resolve,1));throw new Error("upload failed");}
      await new Promise(resolve=>setTimeout(resolve,20));drained=true; return index;
    })).rejects.toThrow("upload failed");
    expect(started).toEqual([0,1]);expect(drained).toBe(true);
  });
  it("keeps matching scores and handwritten corrections unchanged, using one catalogue read", async () => {
    const db=await getReadyDb(); const queries=["青莱","士豆","豆付","不认识的材料"];
    const expected=await Promise.all(queries.map(query=>suggestIngredients(db,query)));
    const spy=vi.spyOn(db.ingredient,"findMany");
    try {
      const match=await createIngredientMatcher(db);
      expect(queries.map(query=>match(query))).toEqual(expected);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {spy.mockRestore();}
    const score=createNameScorer();
    for(const query of queries) for(const candidate of ["青菜","土豆","豆腐","大白菜"]) {
      expect(score(query,candidate)).toEqual(scoreName(query,candidate));
    }
  });
});
