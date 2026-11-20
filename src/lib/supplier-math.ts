/** Original-price suggestions use decimal strings so binary floats cannot change a cent. */
export function supplierSuggestedAmount(price:string,quantity:string):string {
 const parse=(value:string)=>{const m=/^(\d{1,14})(?:\.(\d{1,8}))?$/.exec(value);if(!m)return null;const fraction=m[2]||"";return {value:BigInt(m[1]+fraction),scale:10n**BigInt(fraction.length)};};
 const p=parse(price),q=parse(quantity);if(!p||!q)return "";const product=p.value*q.value*100n,scale=p.scale*q.scale;const cents=product/scale+(product%scale*2n>=scale?1n:0n);return String(cents/100n)+"."+String(cents%100n).padStart(2,"0");
}

export function supplierPaymentTotal(values:readonly string[]):string|null {
 let cents=0n;for(const value of values){if(!value)continue;if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))return null;const [whole,fraction=""]=value.split(".");cents+=BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));}return String(cents/100n)+"."+String(cents%100n).padStart(2,"0");
}
