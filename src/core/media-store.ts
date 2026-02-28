/**
 * Persistent media store with content-addressable 3-word filenames.
 *
 * Hash file content (SHA-256) → pick 3 words from a 256-word table
 * → deterministic, short, human-readable names like `bright-ocean-leaf.png`.
 *
 * Same content always maps to the same name. Files stored in `data/media/`.
 */
import { createHash } from 'node:crypto'
import { readFile, copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

/** 256 short, common English words — one per byte value. */
const WORDS = [
  'ace','aim','air','ant','ape','arc','arm','art','ash','axe',
  'bag','bar','bat','bay','bed','bee','big','bit','bow','box',
  'bud','bug','bus','cab','cam','cap','car','cat','cob','cod',
  'cog','cop','cow','cub','cup','cut','dab','dam','day','den',
  'dew','dig','dim','dip','doc','dog','dot','dry','dub','dug',
  'dye','ear','eel','egg','elk','elm','emu','end','era','eve',
  'ewe','eye','fan','far','fax','fed','fig','fin','fir','fit',
  'fix','fly','fog','fox','fry','fun','fur','gag','gap','gas',
  'gem','gin','gnu','gum','gun','gut','gym','ham','hat','hay',
  'hen','hex','hid','hip','hog','hop','hot','hub','hue','hug',
  'hum','hut','ice','imp','ink','inn','ion','ire','ivy','jab',
  'jag','jam','jar','jaw','jay','jet','jig','job','jog','joy',
  'jug','keg','ken','key','kid','kin','kit','lab','lad','lag',
  'lap','law','lay','lea','led','leg','let','lid','lip','lit',
  'log','lot','low','lug','mad','map','mat','maw','men','met',
  'mid','mix','mob','mod','mop','mow','mud','mug','nab','nag',
  'nap','net','new','nil','nip','nit','nod','nor','not','now',
  'nun','nut','oak','oar','oat','odd','ode','oil','old','one',
  'opt','orb','ore','our','out','owl','own','pad','pal','pan',
  'paw','pay','pea','peg','pen','pet','pie','pig','pin','pit',
  'ply','pod','pop','pot','pry','pub','pug','pun','pup','put',
  'rag','ram','ran','rap','rat','raw','ray','red','ref','rib',
  'rid','rig','rim','rip','rob','rod','rot','row','rub','rug',
  'rum','run','rut','rye','sac','sad','sag','sap','sat','saw',
  'say','sea','set','sew','shy','sin','sip','sir','sit','six',
  'ski','sky','sly','sob','sod','son',
] as const

const MEDIA_DIR = join(process.cwd(), 'data', 'media')

/**
 * Copy a file into the persistent media store.
 * Returns the short name (e.g. `ace-fog-cup.png`) — caller builds the URL.
 */
export async function persistMedia(filePath: string): Promise<string> {
  await mkdir(MEDIA_DIR, { recursive: true })

  const buf = await readFile(filePath)
  const hash = createHash('sha256').update(buf).digest()

  const w1 = WORDS[hash[0]]
  const w2 = WORDS[hash[1]]
  const w3 = WORDS[hash[2]]

  const ext = extname(filePath).toLowerCase() || '.bin'
  const name = `${w1}-${w2}-${w3}${ext}`
  const dest = join(MEDIA_DIR, name)

  if (!existsSync(dest)) {
    await copyFile(filePath, dest)
  }

  return name
}

/** Resolve a media name to its absolute path on disk. */
export function resolveMediaPath(name: string): string {
  return join(MEDIA_DIR, name)
}
