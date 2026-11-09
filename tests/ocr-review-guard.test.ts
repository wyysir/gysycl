import { describe, expect, it } from 'vitest';
import { reviewNames } from '../scripts/ocr-review-guard';

const primary = () => [{lineNo: 1, rawName: '测试旧名', quantity: 2, unitPrice: 7, amount: 14}];
const row = () => ({lineNo: 1, rawName: '测试新名', sourceLineText: '测试新名 2袋×7=14',
  nameWritingType: 'handwritten', writingConfidence: .99, nameConfidence: .95,
  quantity: 2, unitPrice: 7, amount: 14});
describe('experimental name review guard (offline, no cloud accuracy claim)', () => {
  it('accepts a unique aligned handwritten name without mutating primary numbers', () => {
    const p = primary(), snapshot = structuredClone(p);
    expect(reviewNames(p, {items:[row()]})).toMatchObject([{changed:true, name:'测试新名'}]);
    expect(p).toEqual(snapshot);
  });
  it.each(['printed', 'mixed', 'unknown'])('keeps %s names even on a mixed document', type => {
    expect(reviewNames(primary(), {items:[{...row(), nameWritingType:type}]} )[0].changed).toBe(false);
  });
  it.each(['quantity', 'unitPrice', 'amount'])('rejects mismatched %s anchors', field => {
    expect(reviewNames(primary(), {items:[{...row(), [field]:3}]} )[0].reason).toBe('numeric-anchor-mismatch');
  });
  it('rejects duplicated numeric anchors rather than trusting row numbers', () => {
    const p = [...primary(), {...primary()[0],lineNo:2}], r = [row(), {...row(),lineNo:2}];
    expect(reviewNames(p,{items:r}).every(x => x.reason === 'ambiguous-anchor')).toBe(true);
  });
  it('requires quantity and amount, but permits a genuinely blank unit price', () => {
    expect(reviewNames(primary(),{items:[{...row(),unitPrice:null}]})[0].changed).toBe(true);
    for (const key of ['quantity','amount']) expect(reviewNames(primary(),{items:[{...row(),[key]:null}]})[0].changed).toBe(false);
  });
  it('does not use unit prices to disambiguate identical quantity and amount', () => {
    const p = [...primary(), {...primary()[0],lineNo:2,unitPrice:8}];
    expect(reviewNames(p,{items:[row(),{...row(),lineNo:2,unitPrice:8}]}).every(x => !x.changed)).toBe(true);
  });
  it('isolates an invalid row while preserving valid row correspondence', () => {
    const p = [...primary(), {...primary()[0],lineNo:2,quantity:3,amount:21}];
    const r = [{...row(),nameConfidence:NaN},{...row(),lineNo:2,quantity:3,amount:21}];
    expect(reviewNames(p,{items:r}).map(x => x.changed)).toEqual([false,true]);
  });
  it.each([null, {}, {items:[]}, {items:[{...row(),lineNo:2}]}, {items:[{...row(),amount:'14'}]},
    {items:[{...row(),nameConfidence:NaN}]}, {items:[{...row(),writingConfidence:1.1}]}])('fails closed for malformed responses %#', response => {
    expect(reviewNames(primary(),response)[0]).toMatchObject({changed:false,name:'测试旧名'});
  });
  it.each(['测试旧名袋', '4张', '大桶', '测试?名', '测试新名2'])('rejects suffixes and uncertain names: %s', name => {
    expect(reviewNames(primary(),{items:[{...row(),rawName:name,sourceLineText:name+' 2×7=14'}]})[0].changed).toBe(false);
  });
  it('requires explicit source text and handwriting confidence', () => {
    expect(reviewNames(primary(),{items:[{...row(),sourceLineText:'没有对应文字'}]})[0].changed).toBe(false);
    expect(reviewNames(primary(),{items:[{...row(),writingConfidence:.9}]})[0].changed).toBe(false);
  });
});
