import test from 'node:test'
import assert from 'node:assert/strict'
import {crc32,deflateSync} from 'node:zlib'
import {isHandoverSignature as source} from '../../BelleLocal POS app/functions/src/pos/handover-signature.js'
import {isHandoverSignature as browser} from '../../BelleLocal POS app/src/shared/pos-domain/handover-signature.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
const chunk=(type,data)=>{const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
function png({filter=0,color=6,width=2,height=2,extra=0,corruptAdler=false}={}){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=color
  const stride=width*(color===6?4:3),raw=Buffer.alloc((stride+1)*height+extra)
  for(let index=0;index<height;index++){raw[index*(stride+1)]=filter;if(color===6)raw[index*(stride+1)+4]=255}
  const data=deflateSync(raw);if(corruptAdler)data[data.length-1]^=1
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',data),chunk('IEND',Buffer.alloc(0))]).toString('base64')
}
test('browser signature validates the source PNG dimensions/filters/alpha/CRC/ink and rejects malformed or oversized inflation',()=>{
  const cases=[signatureFixture(),signatureFixture(false),'not PNG',null,'data:image/png;base64,AAAA',png({width:1025}),png({height:513}),png({filter:5}),png({extra:1}),png({extra:100000}),png({corruptAdler:true})]
  for(const color of[2,6])for(let filter=0;filter<=4;filter++)cases.push(png({color,filter}))
  const valid=Buffer.from(signatureFixture().slice(22),'base64')
  for(const at of[0,8,12,24,29,valid.length-1]){const mutated=Buffer.from(valid);mutated[at]^=1;cases.push('data:image/png;base64,'+mutated.toString('base64'))}
  cases.push(signatureFixture()+'AAAA')
  for(const value of cases)assert.equal(browser(value),source(value),String(value).slice(0,45))
  assert.equal(browser(signatureFixture()),true);assert.equal(browser(signatureFixture(false)),false)
})
