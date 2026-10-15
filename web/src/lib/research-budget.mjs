import pg from 'pg';
let pool;
/** Durable global admission limits; no question text, IPs, or responses stored. */
export async function reserveResearchRequest(kind) {
  if(process.env.OPENVALLEY_PERSISTENT_LIMITS!=='true')return {release:async()=>{}};
  const connectionString=process.env.RESEARCH_DATABASE_URL;
  if(!connectionString||new URL(connectionString).username!=='research_reader')throw new Error('Usage controls unavailable');
  if(!pool){
    pool=new pg.Pool({connectionString,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:2000,statement_timeout:3000,query_timeout:4000,allowExitOnIdle:true});
    pool.on('error',()=>{});
  }
  const {rows}=await pool.query('SELECT request_budget.reserve($1) AS id',[kind]);
  const id=rows[0]?.id;
  if(!id)return null;
  return {release:async()=>{
    try{await pool.query('SELECT request_budget.release($1::uuid)',[id]);}
    catch{console.warn(JSON.stringify({event:'research_budget_release_failed'}));}
  }};
}
