import test from 'node:test'
import assert from 'node:assert/strict'
import {cleanCart,addCartItem} from '../dashboard/shared/cart.js'
import {cartKey,recipeSelection} from '../dashboard/shared/recipe.js'
test('Persisted recipe choices remain distinct cart lines; matching choices combine without dropping their snapshot',()=>{
 const first={variant_id:'menu',quantity:1,measurements:{},modifier_option_ids:['less']},second={...first,modifier_option_ids:['extra']}
 const cart=addCartItem(addCartItem([],first,3),second,3);assert.equal(cart.length,2);assert.notEqual(cartKey(cart[0]),cartKey(cart[1]));assert.deepEqual(cleanCart(cart),cart)
 const combined=addCartItem(cart,first,3);assert.equal(combined[0].quantity,2);assert.equal(combined[1].quantity,1);assert.throws(()=>addCartItem(combined,first,2),/Only 2 available/)
 assert.deepEqual(cleanCart([{...first,modifier_option_ids:['invalid/path']}]),[])
})
test('Selection totals include the signed modifier once and invalid or missing required choices prevent checkout',()=>{
 const variant={price:900,recipe:{modifier_groups:[{name:'Choice',required:true,min_select:0,max_select:1,options:[{id:'less',name:'Less',price_delta:100},{id:'credit',name:'Credit',price_delta:-1000}]}]}}
 assert.equal(recipeSelection(variant,[]).valid,false);assert.equal(recipeSelection(variant,['foreign']).valid,false);assert.equal(recipeSelection(variant,['less','credit']).valid,false);assert.equal(recipeSelection(variant,['less']).price,1000);assert.equal(recipeSelection(variant,['credit']).price,0)
})
