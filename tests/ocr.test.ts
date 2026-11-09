// Copy to the isolated workspace's tests/ directory and run with Vitest.
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const channel = vi.hoisted(() => ({
  fetch: vi.fn(),
  requests: vi.fn(),
}));
vi.mock('@/lib/config', () => ({ env: {
  OCR_MODE: 'aliyun', DASHSCOPE_API_KEY: 'test-only',
  DASHSCOPE_BASE_URL: 'https://offline.invalid', QWEN_VL_MODEL: 'test-model',
} }));
import { extractDocuments, preprocessImage } from '@/server/ocr';
import { dateOnly } from '@/lib/text';
import { evaluateDocumentChecks, type CheckContext } from '@/domain/checks';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function stubVision(primary: typeof fetch) {
  vi.stubGlobal('fetch',async(input: RequestInfo | URL,init?:RequestInit)=>{
    channel.requests(input,JSON.parse(String(init?.body)));
    return primary(input,init);
  });
}

const image = () => sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
const vlm = () => ({writingType:'printed',supplierName:'测试供应商',docDate:'2026-10-20',docDateText:'26年10月20日',dateConfidence:0.99,subtotal:42,totalAmount:42,
  items:[{lineNo:1,rawName:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,nameConfidence:0.99,unitConfidence:0.99,confidence:0.9}]});
const okVlm = () => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(vlm())}}]}),{status:200});
describe('offline OCR failure injection (no real cloud accuracy claim)', () => {
  it('reuses the prepared image and still makes only one model request', async () => {
    const prepared=await preprocessImage(await image());
    stubVision(channel.fetch.mockResolvedValue(okVlm()));
    const result=await extractDocuments([Buffer.from('raw image already processed')],[prepared]);
    expect(result.items[0].rawName).toBe('青菜');
    expect(channel.requests).toHaveBeenCalledTimes(1);
    const body=channel.requests.mock.calls[0][1];
    expect(body.messages[0].content.find((part:{type:string})=>part.type==='image_url').image_url.url)
      .toBe(`data:image/jpeg;base64,${prepared.buffer.toString('base64')}`);
  });
  it.each([
    {quantity:5,unit:'斤',spec:'5斤',expectedQuantity:5,expectedUnit:'斤'},
    {quantity:0.5,unit:'斤',spec:'0.5斤 x 25 = 12.5',expectedQuantity:0.5,expectedUnit:'斤'},
    {quantity:5,unit:'包',spec:'5包 x 4 = 20',expectedQuantity:5,expectedUnit:'包'},
    {quantity:2,unit:'瓶',spec:'1瓶',expectedQuantity:2,expectedUnit:'瓶'},
    {quantity:12,unit:'斤',spec:'5斤',expectedQuantity:12,expectedUnit:'斤'},
    {quantity:'5斤',unit:'',spec:'5斤',expectedQuantity:5,expectedUnit:'斤'},
    {quantity:'０.５斤',unit:'',spec:'0.5斤',expectedQuantity:0.5,expectedUnit:'斤'},
    {quantity:5,unit:'公斤',spec:'散装',expectedQuantity:5,expectedUnit:'kg'},
    {quantity:5,unit:'',spec:'5',expectedQuantity:5,expectedUnit:''},
    {quantity:1,unit:'',spec:'1斤 x 38 = 38',expectedQuantity:1,expectedUnit:'斤'},
    {quantity:5,unit:'',spec:'5包×4=20',expectedQuantity:5,expectedUnit:'包'},
    {quantity:2,unit:'',spec:'1瓶',expectedQuantity:2,expectedUnit:'瓶'},
    {quantity:5,unit:'',spec:'5斤/袋',expectedQuantity:5,expectedUnit:''},
  ])('uses the unit as specification for $quantity / $unit / $spec',async(input)=>{
    const output={...vlm(),items:[{...vlm().items[0],quantity:input.quantity,unit:input.unit,spec:input.spec}]};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}))));
    const result=await extractDocuments([await image()]);
    expect(result.items[0]).toMatchObject({quantity:input.expectedQuantity,unit:input.expectedUnit,spec:input.expectedUnit});
    expect(result.items[0].rawOcr.spec).toBe(input.spec);
    expect(result.items[0].amount).toBe(42);
  });
  it('preserves zero totals from the vision model instead of replacing them with the subtotal',async()=>{
    const output={...vlm(),totalAmount:0};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}))));
    const d=await extractDocuments([await image()]);expect(d.totalAmount).toBe(0);expect(d.subtotal).toBe(42);
  });
  it('requests only the retained vision model and does not apply an OCR confidence bonus',async()=>{
    stubVision(channel.fetch.mockResolvedValue(okVlm()));
    const d=await extractDocuments([await image()]);
    expect(channel.fetch).toHaveBeenCalledTimes(1);expect(JSON.parse(channel.fetch.mock.calls[0][1].body).model).toBe('test-model');
    expect(channel.requests).toHaveBeenCalledTimes(1);
    expect(channel.requests.mock.calls.every(([url,body])=>String(url)==='https://offline.invalid/chat/completions' && body.model==='test-model')).toBe(true);
    expect(d.provider).toBe('test-model');expect(d.items[0].confidence).toBe(0.9);expect(d.raw).not.toHaveProperty('ocrText');
  });
  it.each(['timeout','not json'])('keeps a failed vision request recoverable (%s)',async(mode)=>{
    stubVision(channel.fetch.mockImplementation(async()=>{
      if(mode==='timeout')throw new Error('simulated VLM outage');
      return new Response(JSON.stringify({choices:[{message:{content:'not json'}}]}));
    }));
    await expect(extractDocuments([await image()])).rejects.toThrow();
    expect(channel.requests).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['26年10月3日','2026-10-03',0.99,'2026-10-03'],
    ['26年10月3日','2026-10-31',0.99,null],
    ['年10月3日','2026-10-03',0.99,null],
    ['10月3日','2026-10-03',0.99,null],
    ['2026-02-30','2026-02-30',0.99,null],
    ['2026-10-03','2026-10-03',0.7,null],
    ['', '2026-10-03',0.99,null],
  ])('requires literal complete date evidence %s',async(text,date,confidence,expected)=>{
    const output={...vlm(),docDateText:text,docDate:date,dateConfidence:confidence};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}))));
    const d=await extractDocuments([await image()]);
    expect(d.docDate ? dateOnly(d.docDate) : null).toBe(expected);
    if(!expected)expect(d.warnings.join()).toContain('日期');
  });
  it('retains handwritten names, uncertain units and a printed rounding amount for review',async()=>{
    const output={...vlm(),writingType:'handwritten',items:[{...vlm().items[0],rawName:'花?',unit:'',quantity:42.2,unitPrice:1.2,amount:50.6,confidence:0.99,nameConfidence:0.7,unitConfidence:0}]};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}))));
    const d=await extractDocuments([await image()]);expect(d.items[0]).toMatchObject({rawName:'花?',unit:'',amount:50.6});expect(d.items[0].confidence).toBeLessThan(0.9);
    expect(d.warnings.join()).toContain('已读取的送货日期');
  });
  it.each([
    {writingType:'handwritten',nameConfidence:0.99,unitConfidence:0.99},
    {writingType:'printed',nameConfidence:0.4,unitConfidence:0.99},
    {writingType:'printed',nameConfidence:0.99,unitConfidence:0.4},
    {writingType:undefined,nameConfidence:0.99,unitConfidence:0.99},
  ])('keeps uncertain fields visible without a second paid request ($writingType)',async(fields)=>{
    const output={...vlm(),writingType:fields.writingType,items:[{...vlm().items[0],...fields}]};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}))));
    const d=await extractDocuments([await image()]);
    expect(channel.requests).toHaveBeenCalledTimes(1);expect(d.items[0].confidence).toBeLessThan(0.9);
    expect(d.items[0]).toMatchObject({quantity:10,unitPrice:4.2,amount:42,unit:'kg'});
    expect(d.warnings.length).toBeGreaterThan(0);
    expect(d.raw).toMatchObject({recognitionVersion:'qwen-single-v4-package'});expect(d.raw).not.toHaveProperty('fieldReview');
  });
  it('requires field evidence even when overall model confidence is high',async()=>{
    const item={...vlm().items[0],confidence:1,nameConfidence:undefined,unitConfidence:undefined};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...vlm(),items:[item]})}}]}))));
    const d=await extractDocuments([await image()]);
    expect(d.items[0].confidence).toBe(0.85);expect(channel.requests).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['面粉2袋',2,'面粉','袋'],['酱1大桶',1,'酱','大桶'],['一号粉2件',3,'一号粉2件',''],['维生素B12',12,'维生素B12',''],
  ])('splits an explicit matching handwritten quantity suffix %s',async(rawName,quantity,name,unit)=>{
    const v={...vlm(),items:[{...vlm().items[0],rawName,quantity,unit:'',spec:''}]};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(v)}}]}))));
    expect((await extractDocuments([await image()])).items[0]).toMatchObject({rawName:name,quantity,unit});
  });
  it.each([
    {name:'调味酱大桶',unit:'大桶',quantity:1,expected:'调味酱',changed:true},
    {name:'食用油小瓶',unit:'小瓶',quantity:2,expected:'食用油',changed:true},
    {name:'调味酱大桶',unit:'桶',quantity:1,expected:'调味酱大桶',changed:false},
    {name:'调味酱大桶',unit:'',quantity:1,expected:'调味酱大桶',changed:false},
    {name:'调味酱大桶',unit:'大桶',quantity:0,expected:'调味酱大桶',changed:false},
    {name:'塑料水桶',unit:'桶',quantity:2,expected:'塑料水桶',changed:false},
    {name:'大桶',unit:'大桶',quantity:1,expected:'大桶',changed:false},
    {name:'大桶装水',unit:'大桶',quantity:1,expected:'大桶装水',changed:false},
  ])('separates only an already extracted compound package unit: $name / $unit',async({name,unit,quantity,expected,changed})=>{
    const item={...vlm().items[0],rawName:name,unit,spec:unit,quantity};
    stubVision(channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...vlm(),items:[item]})}}]}))));
    const result=await extractDocuments([await image()]);
    expect(channel.fetch).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({rawName:expected,unit,spec:unit,quantity,unitPrice:4.2,amount:42,rawOcr:{rawName:name}});
    expect(result.warnings.some(x=>x.includes('包装单位已分离'))).toBe(changed);
    if(changed)expect(result.items[0].confidence).toBeLessThan(0.9);
  });
  it('O06 corrupt image raises an error before cloud access',async()=>{
    await expect(extractDocuments([Buffer.from('not an image')])).rejects.toThrow();expect(channel.fetch).not.toHaveBeenCalled();
  });
  it('O07 preprocessing limits pixels and converts to JPEG',async()=>{
    const input=await sharp({create:{width:4000,height:2000,channels:3,background:'white'}}).png().toBuffer();
    const output=await preprocessImage(input);expect(output.width).toBe(3000);expect(output.height).toBe(1500);expect(output.mime).toBe('image/jpeg');
  });
  function pageResponse(index: number, total: number | null, scope = 'document') {
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
      ...vlm(), docNo:'MULTI-1', totalAmount:total, totalScope:scope,
      items:[{...vlm().items[0],rawName:`第${index}页材料`,amount:index*10,quantity:1,unitPrice:index*10}],
    })}}]}));
  }
  it.each([2,5])('recognizes every page separately and preserves page provenance (%s pages)',async(count)=>{
    for(let i=1;i<=count;i++) channel.fetch.mockResolvedValueOnce(pageResponse(i,999));
    stubVision(channel.fetch);
    const result=await extractDocuments(await Promise.all(Array.from({length:count},image)));
    expect(result.items.map(item=>item.rawName)).toEqual(Array.from({length:count},(_,i)=>`第${i+1}页材料`));
    expect(result.items.map(item=>item.rawOcr.pageNo)).toEqual(Array.from({length:count},(_,i)=>i+1));
    expect(result.items.map(item=>item.lineNo)).toEqual(Array.from({length:count},(_,i)=>i+1));
    expect(result.totalAmount).toBe(999 * count); // Keep printed total; never force it to sum of items.
    expect(channel.fetch).toHaveBeenCalledTimes(count);
    expect(channel.requests).toHaveBeenCalledTimes(count);
    for(const [,init] of channel.fetch.mock.calls) {
      const body=JSON.parse(init.body);
      expect(body.messages[0].content.filter((part:{type:string})=>part.type==='image_url')).toHaveLength(1);
    }
  });
  it('does not claim success when a middle page returns no structured rows',async()=>{
    channel.fetch.mockResolvedValueOnce(pageResponse(1,null));
    channel.fetch.mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...vlm(),items:[]})}}]})));
    stubVision(channel.fetch);
    await expect(extractDocuments([await image(),await image(),await image()])).rejects.toMatchObject({status:422,message:expect.stringContaining('第 2 页')});
    expect(channel.fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps transport failure retryable when a page has only OCR text',async()=>{
    channel.fetch.mockRejectedValue(new Error('offline transport timeout'));
    stubVision(channel.fetch);
    await expect(extractDocuments([await image(),await image()])).rejects.not.toHaveProperty('status');
  });
  it('rejects mixed suppliers instead of merging their ledgers',async()=>{
    channel.fetch.mockResolvedValueOnce(pageResponse(1,10));
    channel.fetch.mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...vlm(),supplierName:'另一个供应商'})}}]})));
    stubVision(channel.fetch);
    await expect(extractDocuments([await image(),await image()])).rejects.toMatchObject({status:422,message:expect.stringContaining('供应商分批')});
  });
  it('adds each image total including equal totals',async()=>{
    channel.fetch.mockResolvedValueOnce(pageResponse(1,10,'page')).mockResolvedValueOnce(pageResponse(2,20,'page'));
    stubVision(channel.fetch);
    expect((await extractDocuments([await image(),await image()])).totalAmount).toBe(30);
    channel.fetch.mockResolvedValueOnce(pageResponse(1,30)).mockResolvedValueOnce(pageResponse(2,30));
    expect((await extractDocuments([await image(),await image()])).totalAmount).toBe(60);
  });
  it('requires manual completion when one image has no printed total',async()=>{
    channel.fetch.mockResolvedValueOnce(pageResponse(1,42)).mockResolvedValueOnce(pageResponse(2,null));
    stubVision(channel.fetch);
    const result=await extractDocuments([await image(),await image()]);
    expect(result.totalAmount).toBe(0);
    expect(result.warnings.join()).toContain('第 2 张未识别到原单总价');
  });
  it('preserves an explicit zero grand total across multiple pages',async()=>{
    channel.fetch.mockResolvedValueOnce(pageResponse(1,null)).mockResolvedValueOnce(pageResponse(2,0));
    stubVision(channel.fetch);
    expect((await extractDocuments([await image(),await image()])).totalAmount).toBe(0);
  });
  it('merges different original notes for one supplier, retaining headers and adding original totals',async()=>{
    for(const [docNo,date,amount] of [['A','2026-10-20',42],['B','2026-10-21',80]] as const) {
      channel.fetch.mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
        ...vlm(),docNo,docDate:date,docDateText:date,totalAmount:amount,totalScope:'document',
      })}}]})));
    }
    stubVision(channel.fetch);
    const result=await extractDocuments([await image(),await image()]);
    expect(result.items).toHaveLength(2);expect(result.totalAmount).toBe(122);
    expect(result.docNo).toBe('');expect(result.docDate).toBeNull();
    expect(result.raw.pages).toMatchObject([{sourceDocNo:'',sourceDocDate:'2026-10-20'},{sourceDocNo:'',sourceDocDate:'2026-10-21'}]);
  });
  it('adds image totals without original note numbers',async()=>{
    for(let i=0;i<2;i++) channel.fetch.mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...vlm(),docNo:'',totalScope:'document'})}}]})));
    stubVision(channel.fetch);
    const result=await extractDocuments([await image(),await image()]);
    expect(result.totalAmount).toBe(84);
  });
});

function context():CheckContext {return {
  document:{projectId:'p',supplierId:'s',docDate:new Date('2026-10-20'),subtotal:42,totalAmount:42},
  items:[{lineNo:1,name:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,confidence:1,ingredientId:'i',matchStatus:'MATCHED'}],
  contracts:[{id:'c',projectId:'p',supplierId:'s',ingredientId:'i',spec:'散装',unit:'kg',unitPrice:4.2,startsOn:new Date('2026-01-01'),endsOn:new Date('2026-12-31')}],
  history:[],benchmark:[],thresholds:{ocrConfidence:0.9,crossPriceTolerance:0.1,historyPriceTolerance:0.1,quantityOutlierMultiplier:2,minBenchmarkSamples:3},
};}
describe('additional acceptance boundaries',()=>{
  it('D01 even one cent requires correction or explicit reduction confirmation',()=>{
    const c=context();c.items[0].amount=42.01;expect(evaluateDocumentChecks(c).some(x=>x.type==='line_arithmetic')).toBe(true);
    c.items[0].amount=42.02;expect(evaluateDocumentChecks(c).some(x=>x.type==='line_arithmetic'&&x.severity==='ERROR')).toBe(true);
  });
  it('D02 contracts from another project or different spec/unit/period are not used',()=>{
    for(const patch of [{projectId:'other'},{spec:'different'},{unit:'袋'},{endsOn:new Date('2026-10-19')},{startsOn:new Date('2026-10-21')}]){
      const c=context();Object.assign(c.contracts[0],patch);const r=evaluateDocumentChecks(c);expect(r.some(x=>x.type==='contract_missing')).toBe(true);expect(r.some(x=>x.type==='contract_price')).toBe(false);
    }
  });
  it('D03 two market samples are insufficient; three allow warning',()=>{
    const c=context();const row={ingredientId:'i',supplierId:'s2',projectId:'p2',spec:'散装',unit:'kg',quantity:1,unitPrice:3};c.benchmark=[row,row];
    expect(evaluateDocumentChecks(c).some(x=>x.type==='benchmark_insufficient')).toBe(true);c.benchmark.push(row);expect(evaluateDocumentChecks(c).some(x=>x.type==='cross_supplier_price')).toBe(true);
  });
  it('D04 historical overprice and quantity above double generate warnings',()=>{
    const c=context();c.history=[{ingredientId:'i',supplierId:'s',projectId:'p',spec:'散装',unit:'kg',quantity:4,unitPrice:3}];
    const types=evaluateDocumentChecks(c).map(x=>x.type);expect(types).toContain('historical_price');expect(types).toContain('quantity_outlier');
  });
  it('D05 zero confidence must be flagged for manual review',()=>{
    const c=context();c.items[0].confidence=0;expect(evaluateDocumentChecks(c).some(x=>x.type==='low_confidence')).toBe(true);
  });
});
