import { doc,getDocFromServer,runTransaction,serverTimestamp } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { normalizeDirectOrder } from './direct-orders.js'
import { prepareFrozenBooking } from './frozen-booking.js'
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})}
// Immutable proof staging has no stock effect. Only the final transaction
// commits all booked rights, private order, receipt and safe pending tracking.
export function createFrozenOrderRepository({db,auth,sdk={doc,getDocFromServer,runTransaction,serverTimestamp},authenticate=async()=>{
  await auth.authStateReady();if(!auth.currentUser)await signInAnonymously(auth);return auth.currentUser
}}){
  const root='onlineShopV2/belle-online',ref=(table,key)=>sdk.doc(db,`${root}/${table}/${key}`)
  const nested=(key,table,index)=>sdk.doc(db,`${root}/checkout_drafts/${key}/${table}/${index}`)
  async function attemptSubmit(body,observed){
    if(!db.app.options.projectId.startsWith('demo-'))fail('Direct checkout is waiting for complete POS ledger adoption.',503)
    const input=normalizeDirectOrder(body)
    if(new TextEncoder().encode(JSON.stringify(input)).length>64000)fail('This cart exceeds the supported request size.',400)
    const user=await authenticate();if(!user?.uid || !user.isAnonymous)fail('A customer session could not be established.',401)
    const payloadHash=await hash(JSON.stringify(input)),trackingHash=await hash(input.tracking_token)
    const receiptRef=ref('public_submission_receipts',input.request_key)
    const replay=value=>{if(value.created_by!==user.uid || value.request_hash!==payloadHash)fail('This request key was already used with different order details.');return {reference:value.reference,tracking_token:input.tracking_token}}
    const checkedUser=()=>{if(auth.currentUser?.uid!==user.uid)fail('The customer session changed.',401)}
    const bookRef=ref('public_checkout_book','main');let isNew=false
    try{
      const existing=await sdk.getDocFromServer(receiptRef);if(existing.exists())return replay(existing.data());isNew=true
      const book=(await sdk.getDocFromServer(bookRef)).data(),frame=book?(await sdk.getDocFromServer(ref('public_checkout_frames',book.frame_id))).data():null
      observed.version=book?.version
      const prepared=prepareFrozenBooking(input,book,frame),draftId=await hash(JSON.stringify([user.uid,input.request_key,book.frame_id,book.version,payloadHash]))
      const reference=`OS-${(await hash(JSON.stringify(['online-order',draftId]))).slice(0,32).toUpperCase()}`,trackingKey=await hash(JSON.stringify([reference,trackingHash]))
      const items=await Promise.all(prepared.items.map(async(item,index)=>({...item,id:await hash(JSON.stringify([input.request_key,index]))})))
      const draftRef=ref('checkout_drafts',draftId),progressRef=nested(draftId,'progress','main')
      await sdk.runTransaction(db,async tx=>{
        checkedUser();const previous=await tx.get(draftRef)
        if(previous.exists())return
        const current=(await tx.get(bookRef)).data(),meta=(await tx.get(ref('direct_stock_meta','main'))).data(),content=(await tx.get(ref('content_meta','main'))).data()
        if(current?.version!==book.version || current.source_revision!==(meta?.version || 0) || current.content_revision!==(content?.version || 0))fail('Shared stock changed. Refresh the shop before ordering.')
        const stamp=sdk.serverTimestamp(),order={id:input.request_key,shop_id:'belle-online',created_by:user.uid,draft_id:draftId,direct_booking_schema:'fifo-frame-v1',frame_id:book.frame_id,reference,request_hash:payloadHash,tracking_hash:trackingHash,
          status:'pending',reservation_state:'reserved',customer_name:input.customer.name,phone:input.customer.phone,city:input.customer.city,address:input.customer.address,note:input.note,
          item_count:items.length,variant_ids:prepared.variantIds,ledger_variant_ids:prepared.variantIds,groups:prepared.groups,group_keys:prepared.groupKeys,stock_reservations:[],subtotal:prepared.subtotal,delivery_fee:prepared.delivery_fee,total:prepared.total,created_at:stamp,expires_after_hours:48,events:[]}
        tx.set(draftRef,{created_by:user.uid,request_hash:payloadHash,frame_id:book.frame_id,book_version:book.version,source_revision:book.source_revision,item_count:items.length,order,next_cursors:prepared.cursors})
        tx.set(progressRef,{next_chunk:0,scope_keys:[],footer_quantity:0,footer_amount:0,delivery_fee:0,last_row:{prefix_quantity:0,prefix_amount:0,stock_scope_key:''}})
      })
      for(const chunk of prepared.chunks){
        await sdk.runTransaction(db,async tx=>{
          checkedUser();const progress=(await tx.get(progressRef)).data()
          if(progress.next_chunk>chunk.index)return
          if(progress.next_chunk!==chunk.index)fail('Checkout proof requires reconciliation.')
          const proof={...chunk,items:items.slice(chunk.index*2,chunk.index*2+2).map(({id,variant_id,quantity,unit_price,measurements,stock_scope_key,prefix_quantity,prefix_amount})=>({id,variant_id,quantity,unit_price,measurements,stock_scope_key,prefix_quantity,prefix_amount}))}
          tx.set(nested(draftId,'chunks',String(chunk.index)),proof)
          tx.set(progressRef,{next_chunk:chunk.index+1,scope_keys:[...progress.scope_keys,...chunk.scope_keys],footer_quantity:chunk.footer_quantity,footer_amount:chunk.footer_amount,delivery_fee:chunk.delivery_fee,last_row:proof.items.at(-1) || progress.last_row})
          for(const [offset,item] of items.slice(chunk.index*2,chunk.index*2+2).entries())tx.set(sdk.doc(db,`${root}/public_tracking/${trackingKey}/items/${chunk.index*2+offset}`),{draft_id:draftId,index:chunk.index*2+offset,name:item.product_name,color:item.color,size:item.size,quantity:item.quantity,unit_price:item.unit_price})
        })
      }
      return await sdk.runTransaction(db,async tx=>{
        checkedUser();const receipt=await tx.get(receiptRef);if(receipt.exists())return replay(receipt.data())
        const source=(await tx.get(draftRef)).data(),progress=(await tx.get(progressRef)).data(),current=(await tx.get(bookRef)).data(),meta=(await tx.get(ref('direct_stock_meta','main'))).data(),content=(await tx.get(ref('content_meta','main'))).data()
        if(progress.next_chunk!==20 || current.version!==source.book_version || current.source_revision!==(meta?.version || 0) || current.content_revision!==(content?.version || 0))fail('Shared stock changed. Refresh the shop before ordering.')
        const stamp=sdk.serverTimestamp()
        tx.set(bookRef,{...current,cursors:source.next_cursors,version:current.version+1,source_revision:meta.version+1,last_request_id:input.request_key})
        tx.set(ref('direct_stock_meta','main'),{version:meta.version+1})
        tx.set(ref('orders',input.request_key),{...source.order,submitted_at:stamp})
        tx.set(receiptRef,{created_by:user.uid,request_hash:payloadHash,reference,order_id:input.request_key,created_at:stamp})
        tx.set(ref('public_tracking',trackingKey),{order_id:input.request_key,item_count:items.length,reference,status:'pending',created_at:stamp,total:prepared.total,delivery_fee:prepared.delivery_fee,courier:'',delivery_reference:'',events:[]})
        return {reference,tracking_token:input.tracking_token}
      })
    }catch(error){error.definitive=isNew && !!error.status && error.status!==503;throw error}
  }
  async function submit(body){
    for(let attempt=0;;attempt++){
      const observed={}
      try{return await attemptSubmit(body,observed)}
      catch(error){
        if(attempt>=3 || observed.version===undefined || !(error.code==='permission-denied' || error.status===409 && error.message==='Shared stock changed. Refresh the shop before ordering.'))throw error
        // Rules may reject stale getAfter authority before the SDK reports
        // ABORTED. Restart proof staging only with newer authoritative evidence.
        const current=(await sdk.getDocFromServer(ref('public_checkout_book','main'))).data()
        if(!(current?.version>observed.version))throw error
      }
    }
  }
  return {submit}
}
