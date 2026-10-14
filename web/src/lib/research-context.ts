import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { planSchema, type QuestionContext } from './research-plan';

const keySymbol=Symbol.for('openvalley.research.context-key');
const state=globalThis as typeof globalThis & {[keySymbol]?: Buffer};
function key(){return state[keySymbol] ??= randomBytes(32);}
const schema=z.object({question:z.string().max(1600),plan:planSchema,version:z.string(),expires:z.number()}).strict();
export function evidenceVersion(library: {corpusDigest:string;policyDigest:string}, releaseId?: string) {
  return createHash('sha256').update(JSON.stringify(['brief-v1',library.corpusDigest,library.policyDigest,releaseId??null])).digest('hex');
}
export function signContext(context: QuestionContext, version: string) {
  const data=Buffer.from(JSON.stringify({...context,version,expires:Date.now()+3600000})).toString('base64url');
  return `${data}.${createHmac('sha256',key()).update(data).digest('base64url')}`;
}
export function readContext(token: unknown, version: string): QuestionContext | undefined {
  if(token===undefined)return undefined;
  if(typeof token!=='string'||token.length>12000)throw new Error('Invalid conversation context');
  const [data,signature,...extra]=token.split('.');
  if(!data||!signature||extra.length)throw new Error('Invalid conversation context');
  const expected=createHmac('sha256',key()).update(data).digest();const actual=Buffer.from(signature,'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('Invalid conversation context');
  const context=schema.parse(JSON.parse(Buffer.from(data,'base64url').toString()));
  if(context.version!==version||context.expires<Date.now())throw new Error('Conversation evidence changed or expired');
  return {question:context.question,plan:context.plan};
}
