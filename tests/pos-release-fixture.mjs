// Server release rows are separate from requested/effective client flags.
// This fixture can seed only an isolated demo Firestore emulator project.
export async function releasePosCapabilities(db,shop,keys){
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||!db.projectId.startsWith('demo-'))throw Error('Release fixtures require an isolated demo project.')
 const batch=db.batch();for(const key of keys)batch.set(db.doc(`onlineShopV2/${shop}/pos_release_features/${key}`),{key,enabled:true,public:true});await batch.commit()
}
