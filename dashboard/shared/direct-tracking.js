import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore'

const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2,'0')).join('')
export function createDirectTracking({ db,sdk = { collection,doc,getDocFromServer,getDocsFromServer } }) {
  return async (reference,token) => {
    const missing = () => { throw Object.assign(new Error('Order not found.'),{status:404}) }
    if (!/^OS-[A-F0-9]{32}$/.test(reference || '') || !/^[a-f0-9]{64}$/.test(token || '')) missing()
    const key = await hash(JSON.stringify([reference,await hash(token)]))
    const value = (await sdk.getDocFromServer(sdk.doc(db,`onlineShopV2/belle-online/public_tracking/${key}`))).data()
    if (!value || value.reference !== reference) missing()
    // A capability link permits an exact get only. The projection contains no
    // recipient, phone, address, private notes, costs or payment details.
    const rows=(await sdk.getDocsFromServer(sdk.collection(db,`onlineShopV2/belle-online/public_tracking/${key}/items`))).docs.map(row=>row.data()).sort((a,b)=>a.index-b.index)
    if (rows.length !== value.item_count || rows.some((row,index)=>row.index !== index)) throw new Error('Order tracking requires reconciliation. Please contact the shop.')
    const iso=value=>value?.toDate?.().toISOString() || value
    const events=value.events.length ? value.events : [{id:'pending',status:'pending',created_at:value.created_at}]
    return { reference:value.reference,status:value.status,created_at:iso(value.created_at),total:value.total,delivery_fee:value.delivery_fee,courier:value.courier || '',delivery_reference:value.delivery_reference || '',
      items:rows.map(({index:_index,draft_id:_draft,...row})=>row),events:events.map(row=>({...row,created_at:iso(row.created_at)})) }
  }
}
