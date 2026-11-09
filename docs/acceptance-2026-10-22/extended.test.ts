// Copy to the isolated workspace's tests/ directory and run with Vitest.
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const channel = vi.hoisted(() => ({
  table: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/lib/config', () => ({ env: {
  OCR_MODE: 'aliyun', ALIYUN_ACCESS_KEY_ID: 'test-only', ALIYUN_ACCESS_KEY_SECRET: 'test-only',
  ALIYUN_OCR_ENDPOINT: 'offline.invalid', DASHSCOPE_API_KEY: 'test-only',
  DASHSCOPE_BASE_URL: 'https://offline.invalid', QWEN_VL_MODEL: 'test-model',
} }));
vi.mock('@alicloud/ocr-api20210707', () => ({
  default: class { recognizeTableOcrWithOptions(...args: unknown[]) { return channel.table(...args); } },
  RecognizeTableOcrRequest: class { constructor(public value: unknown) {} },
}));
import { extractDocuments, preprocessImage } from '@/server/ocr';
import { evaluateDocumentChecks, type CheckContext } from '@/domain/checks';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const image = () => sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
const vlm = () => ({supplierName:'测试供应商',docDate:'2026-10-20',subtotal:42,totalAmount:42,
  items:[{lineNo:1,rawName:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,confidence:0.9}]});
const okVlm = () => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(vlm())}}]}),{status:200});
describe('offline OCR failure injection (no real cloud accuracy claim)', () => {
  it('O01 both channels succeed and keep structured values',async()=>{
    channel.table.mockResolvedValue({statusCode:200,body:{data:JSON.stringify({text:'10.00 4.20 42.00'})}});
    vi.stubGlobal('fetch',channel.fetch.mockResolvedValue(okVlm()));
    const d=await extractDocuments([await image()]);expect(d.items).toHaveLength(1);expect(d.totalAmount).toBe(42);expect(d.warnings).toHaveLength(0);
  });
  it('O02 OCR channel rejection preserves VLM result',async()=>{
    channel.table.mockRejectedValue(new Error('simulated OCR timeout'));
    vi.stubGlobal('fetch',channel.fetch.mockResolvedValue(okVlm()));
    const d=await extractDocuments([await image()]);expect(d.items).toHaveLength(1);expect(d.warnings.join()).toContain('simulated OCR timeout');
  });
  it('O03 simulated VLM timeout preserves OCR raw text and indicates manual entry',async()=>{
    channel.table.mockResolvedValue({statusCode:200,body:{data:JSON.stringify({text:'仅OCR原始文本'})}});
    vi.stubGlobal('fetch',channel.fetch.mockRejectedValue(new DOMException('simulated VLM timeout','TimeoutError')));
    const d=await extractDocuments([await image()]);expect(d.raw.ocrText).toContain('仅OCR原始文本');expect(d.items).toHaveLength(0);expect(d.warnings.join()).toContain('人工录入');
  });
  it('O04 both channels failing produces recoverable error',async()=>{
    channel.table.mockRejectedValue(new Error('simulated OCR outage'));
    vi.stubGlobal('fetch',channel.fetch.mockRejectedValue(new Error('simulated VLM outage')));
    await expect(extractDocuments([await image()])).rejects.toThrow(/simulated OCR outage/);
  });
  it('O05 malformed VLM JSON does not invent structured rows',async()=>{
    channel.table.mockResolvedValue({statusCode:200,body:{data:'保留OCR文字'}});
    vi.stubGlobal('fetch',channel.fetch.mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'not json'}}]}))));
    const d=await extractDocuments([await image()]);expect(d.items).toHaveLength(0);expect(d.warnings.join()).toContain('视觉模型通道失败');
  });
  it('O06 corrupt image raises an error before cloud access',async()=>{
    await expect(extractDocuments([Buffer.from('not an image')])).rejects.toThrow();expect(channel.fetch).not.toHaveBeenCalled();
  });
  it('O07 preprocessing limits pixels and converts to JPEG',async()=>{
    const input=await sharp({create:{width:4000,height:2000,channels:3,background:'white'}}).png().toBuffer();
    const output=await preprocessImage(input);expect(output.width).toBe(3000);expect(output.height).toBe(1500);expect(output.mime).toBe('image/jpeg');
  });
});

function context():CheckContext {return {
  document:{projectId:'p',supplierId:'s',docDate:new Date('2026-10-20'),subtotal:42,totalAmount:42},
  items:[{lineNo:1,name:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,confidence:1,ingredientId:'i',matchStatus:'MATCHED'}],
  contracts:[{id:'c',projectId:'p',supplierId:'s',ingredientId:'i',spec:'散装',unit:'kg',unitPrice:4.2,startsOn:new Date('2026-01-01'),endsOn:new Date('2026-12-31')}],
  history:[],benchmark:[],thresholds:{ocrConfidence:0.9,crossPriceTolerance:0.1,historyPriceTolerance:0.1,quantityOutlierMultiplier:2,minBenchmarkSamples:3},
};}
describe('additional acceptance boundaries',()=>{
  it('D01 one cent is tolerated; two cents is an ERROR',()=>{
    const c=context();c.items[0].amount=42.01;expect(evaluateDocumentChecks(c).some(x=>x.type==='line_arithmetic')).toBe(false);
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
