import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeOpaqueToken,tokenHash} from '../src/production-contract.mjs';
import {handleProductionComments} from '../src/production-comments.mjs';

function fakeFirestore(){
 const records=new Map();
 const ref=path=>({
  path,id:path.split('/').at(-1),
  async get(){
   const value=records.get(path);
   return {id:path.split('/').at(-1),ref:ref(path),exists:!!value,data:()=>value};
  },
  collection(k){return collection(path+'/'+k);}
 });
 const collection=path=>({
  doc(id){return ref(path+'/'+id);},
  orderBy(field,dir){
   return {limit(n){
    return {async get(){
     const docs=[...records.entries()].filter(([key])=>
      key.startsWith(path+'/')&&key.slice(path.length+1).split('/').length===1)
      .sort((a,b)=>dir==='desc'?b[1][field]-a[1][field]:a[1][field]-b[1][field])
      .slice(0,n).map(([key,value])=>({
       id:key.split('/').at(-1),ref:ref(key),data:()=>value
      }));
     return {docs};
    }};
   }};
  }
 });
 const db={
  collection,
  async runTransaction(fn){
   const tx={
    get:r=>r.get(),
    set(r,value){records.set(r.path,{...value});},
    create(r,value){assert.equal(records.has(r.path),false);records.set(r.path,{...value});},
    update(r,value){const before=records.get(r.path)||{};records.set(r.path,{...before,...value});}
   };
   return fn(tx);
  }
 };
 return {db,records};
}
function request({method='GET',url='/api/gift/comments',data=null,
 cookie=null,admin=false,ip='192.0.2.1'}={}){
 const headers={origin:'https://music.example'};
 if(cookie)headers.cookie='withu_session='+cookie;
 if(admin)headers.authorization='Bearer '+('a'.repeat(100));
 return {
  method,url,originalUrl:url,ip,headers,
  get(name){return headers[name.toLowerCase()]},
  is(type){return type==='application/json'},
  ...(data?{body:data,rawBody:Buffer.from(JSON.stringify(data))}:{})
 };
}
function response(){
 return {statusCode:200,result:null,headers:{},
  status(n){this.statusCode=n;return this;},
  set(k,v){this.headers[k]=v;return this;},
  json(data){this.result=data;return this;}
 };
}
test('real comment API holds new replies pending until the verified owner approves them',async()=>{
 const {db,records}=fakeFirestore();
 const orderId='withu_'+'c'.repeat(32),cookie=makeOpaqueToken();
 const lyrics='이 세상에서 소중한 우리의 추억들을 떠올려요';
 const order={
  id:orderId,productId:'audio',
  paymentStatus:'paid',paymentKey:'pay_123456',paymentVerifiedAt:1234,
  delivery:{status:'sent'},
  tracks:[{index:1,reviewed:true,title:'사랑해',lyrics,
   storagePath:'orders/'+orderId+'/tracks/1.mp3'}]
 };
 records.set('withuOrders/'+orderId,order);
 records.set('withuSessions/'+tokenHash(cookie),{orderId,expiresAt:Date.now()+60000});
 const env={WITHU_PUBLIC_BASE_URL:'https://music.example',WITHU_ADMIN_UID:'operator-withu-123456'};
 const auth={verifyIdToken:async()=>({uid:env.WITHU_ADMIN_UID,email_verified:true})};
 const ctx={db,auth,env};
 const post=response();
 await handleProductionComments(request({
  method:'POST',cookie,data:{nickname:'엄마 친구',text:'너무 아름다운 노래네요!'}
 }),post,ctx);
 assert.equal(post.statusCode,201);
 assert.equal(post.result.status,'pending');
 const before=response();
 await handleProductionComments(request({cookie}),before,ctx);
 assert.equal(before.statusCode,200);
 assert.deepEqual(before.result.comments,[],'No unapproved public comment leaks to visitors');
 const review=response();
 await handleProductionComments(request({
  url:'/api/admin/orders/'+orderId+'/comments',admin:true
 }),review,ctx);
 assert.equal(review.statusCode,200);
 assert.equal(review.result.comments.length,1);
 assert.equal(review.result.comments[0].status,'pending');
 const commentId=review.result.comments[0].id;
 const hidden=response();
 await handleProductionComments(request({
  method:'POST',
  url:'/api/admin/orders/'+orderId+'/comments/'+commentId+'/moderate',
  data:{action:'publish'},admin:true
 }),hidden,ctx);
 assert.equal(hidden.result.status,'published');
 const after=response();
 await handleProductionComments(request({cookie}),after,ctx);
 assert.equal(after.result.comments.length,1);
 assert.equal(after.result.comments[0].text,'너무 아름다운 노래네요!');
 const requestOther=request({cookie});
 records.set('withuSessions/'+tokenHash(cookie),{
  orderId:'withu_'+'d'.repeat(32),expiresAt:Date.now()+60000
 });
 await assert.rejects(()=>handleProductionComments(requestOther,response(),ctx),
  /주문이 존재하지 않습니다/);
});
test('comment rate limiting rejects fourth post in the same authenticated gift session',async()=>{
 const {db,records}=fakeFirestore();
 const orderId='withu_'+'e'.repeat(32),cookie=makeOpaqueToken();
 records.set('withuOrders/'+orderId,{
  id:orderId,productId:'audio',paymentStatus:'paid',paymentKey:'pay_abcdef',
  paymentVerifiedAt:12,delivery:{status:'sent'},
  tracks:[{index:1,reviewed:true,title:'친구에게',
   lyrics:'우리의 모든 기억들을 노래로 전합니다',
   storagePath:'orders/'+orderId+'/tracks/1.mp3'}]
 });
 records.set('withuSessions/'+tokenHash(cookie),{orderId,expiresAt:Date.now()+60000});
 const env={WITHU_PUBLIC_BASE_URL:'https://music.example'};
 const ctx={db,env};
 for(let i=0;i<3;i++){
  const res=response();
  await handleProductionComments(request({
   method:'POST',cookie,data:{nickname:'친구',text:'정말 잘 들었습니다 '+i}
  }),res,ctx);
  assert.equal(res.statusCode,201);
 }
 await assert.rejects(()=>handleProductionComments(request({
  method:'POST',cookie,data:{nickname:'친구',text:'또 남깁니다'}
 }),response(),ctx),/댓글 작성 횟수 제한/);
});
