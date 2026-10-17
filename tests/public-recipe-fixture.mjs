import {randomUUID} from 'node:crypto'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosRecipes} from '../../BelleLocal POS app/functions/src/pos/recipes.js'
import {createShopStock} from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {normalizeProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import {releasePosCapabilities} from './pos-release-fixture.mjs'
export async function publicRecipeFixture(db,shop='public-recipe-'+randomUUID(),{quantity=3,serial=false}={}){
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||!db.projectId.startsWith('demo-'))throw Error('Public recipe fixtures require isolated loopback emulators.')
 const table=name=>db.collection(`onlineShopV2/${shop}/${name}`),catalog=createPosCatalog({db}),recipes=createPosRecipes({db,ownerUid:'demo-owner'}),stock=createShopStock({db})
 await releasePosCapabilities(db,shop,['restaurant.recipes',...(serial?['inventory.serials']:[])])
 await table('pos_settings').doc('main').set({capabilities:{'restaurant.recipes':true,...(serial?{'inventory.serials':true}:{})}})
 const create=(name,amount,price,cost,extra={})=>catalog.create(shop,{name:name+' '+randomUUID(),price,cost,units:[{name:'Piece',isBase:true,conversionFactor:1}],...(amount?{openingStock:{quantity:amount,unitCost:cost}}:{}),...extra},'demo-owner',randomUUID())
 const ingredient=await create('Recipe ingredient',quantity,400,50),menu=await create('Public recipe menu',0,500,77,serial?{trackingMode:'SERIAL'}:{})
 const recipe=(await recipes.replace(shop,menu.id,{yieldQuantity:2,components:[{ingredientProductId:ingredient.id,quantity:3}],modifierGroups:[{name:'Recipe choice',required:true,maxSelect:1,options:[{name:'Less ingredient',priceDelta:100,ingredientDelta:[{productId:ingredient.id,quantity:-.5}]},{name:'Extra ingredient',priceDelta:200,ingredientDelta:[{productId:ingredient.id,quantity:.5}]}]}]},'demo-owner')).recipe
 const publish=async(product,name,price)=>{const value=normalizeProduct({name,slug:'menu-'+randomUUID(),status:'published',variants:[{sku:randomUUID(),color:'Original',size:'1',price,active:true}]},null,shop);await table('products').doc(value.id).set(value);await stock.bind(shop,{public_product_id:value.id,public_variant_id:value.variants[0].id,pos_product_id:product.id},'demo-owner');return value}
 const publicProduct=await publish(menu,'Public recipe',900),ordinary=await publish(ingredient,'Loose ingredient',400)
 await table('store_settings').doc('main').set({delivery_fee:100,checkout_enabled:true})
 const less=recipe.modifierGroups[0].options[0],extra=recipe.modifierGroups[0].options[1],line=(quantity=1,ids=[less.id])=>({variant_id:publicProduct.variants[0].id,quantity,measurements:{},modifier_option_ids:ids}),request=(items=[line()])=>({request_key:randomUUID(),tracking_token:'b'.repeat(64),customer:{name:'Recipe guest',phone:'099123456',city:'Yangon',address:'Private recipe address'},note:'Private recipe note',items})
 return {shop,ingredient,menu,recipe,publicProduct,ordinary,less,extra,line,request,table,recipes,stock}
}
