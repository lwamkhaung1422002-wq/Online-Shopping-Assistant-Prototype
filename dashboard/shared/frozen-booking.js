const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})}
// All authority comes from the owner-published book/frame. Customer prices,
// batch choices and costs are never input. Twenty sealed two-row chunks permit
// Rules to validate a forty-row invoice without one oversized evaluation.
export function prepareFrozenBooking(input,book,frame) {
  if(book?.schema!=='fifo-frame-v1' || frame?.schema!=='fifo-frame-v1' || book.checkout_enabled!==true)fail('Online ordering is not enabled yet. Please contact the shop.')
  if(!Number.isSafeInteger(book.delivery_fee) || book.delivery_fee<0 || book.delivery_fee>2147483647)fail('Delivery terms require reconciliation.')
  const lines=input.items.map(item=>{
    const quote=book.quotes?.[item.variant_id],scope=frame.scopes?.[quote?.scope_key]
    if(!quote?.active || !scope)fail('A selected product is unavailable.')
    if(quote.booking_kind!=='STANDARD' || scope.booking_kind!=='STANDARD')fail('This tracked/recipe choice is waiting for its direct allocation conversion.',501)
    if(!Number.isInteger(quote.unit_price) || quote.unit_price<0 || quote.unit_price>2147483647 || !Number.isSafeInteger(scope.capacity))fail('POS price or stock requires reconciliation.')
    return {...item,quote,scope}
  }).sort((a,b)=>a.quote.scope_key.localeCompare(b.quote.scope_key) || a.variant_id.localeCompare(b.variant_id))
  const groups={},cursors={...book.cursors},items=[],variantIds=[]
  let prefixQuantity=0,prefixAmount=0
  for(const[index,line]of lines.entries()){
    const {quote}=line,key=quote.scope_key
    if(!groups[key]){
      const begin=book.cursors?.[key]
      if(!Number.isSafeInteger(begin) || begin<0 || begin>line.scope.capacity)fail('Shared stock requires reconciliation.')
      groups[key]={start_index:index,end_index:index,prefix_before:prefixQuantity,begin,end:begin}
    }
    const group=groups[key]
    group.end_index=index; group.end+=line.quantity
    if(group.end>line.scope.capacity)fail('The requested quantity exceeds available stock.')
    cursors[key]=group.end; prefixQuantity+=line.quantity; prefixAmount+=line.quantity*quote.unit_price
    if(!Number.isSafeInteger(prefixAmount) || prefixAmount+book.delivery_fee>2147483647)fail('This cart exceeds the supported POS invoice total. Reduce its quantity or contact the shop.')
    items.push({variant_id:line.variant_id,product_id:quote.product_id,product_name:quote.product_name,color:quote.color,size:quote.size,quantity:line.quantity,unit_price:quote.unit_price,measurements:line.measurements,
      stock_scope_key:key,prefix_quantity:prefixQuantity,prefix_amount:prefixAmount})
    variantIds.push(line.variant_id)
  }
  const chunks=Array.from({length:20},(_,index)=>{
    const rows=items.slice(index*2,index*2+2),previous=items[Math.min(index*2,items.length)-1]
    return {index,items:rows,scope_keys:rows.map(row=>row.stock_scope_key),delivery_fee:book.delivery_fee,footer_quantity:rows.at(-1)?.prefix_quantity??previous?.prefix_quantity??0,footer_amount:rows.at(-1)?.prefix_amount??previous?.prefix_amount??0}
  })
  return {items,variantIds,groups,groupKeys:Object.keys(groups),cursors,chunks,subtotal:prefixAmount,delivery_fee:book.delivery_fee,total:prefixAmount+book.delivery_fee}
}
