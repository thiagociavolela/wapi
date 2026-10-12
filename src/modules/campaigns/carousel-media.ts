import path from 'node:path';
import { mkdir,writeFile,access,stat,readFile } from 'node:fs/promises';
import { uploadMedia } from '../meta/client.js';
import { convertProductImageToJpeg } from '../products/service.js';

function mediaPath(organizationId: string,id: string) {
  if(!/^[\da-f-]{36}$/i.test(organizationId)||!/^\d+$/.test(id))throw new Error('Identificador de imagem inválido.');
  return path.resolve('storage','carousel',organizationId,`${id}.jpg`);
}
export async function storeCarouselImage(organizationId: string,buffer: Buffer,prepared=false) {
  if(!prepared)buffer=await convertProductImageToJpeg(buffer,true);
  if(!buffer.length||buffer.length>5*1024*1024)throw new Error('A imagem deve ter até 5 MB após a conversão.');
  const mediaId=await uploadMedia(buffer,'image/jpeg','carousel.jpg');
  const filename=mediaPath(organizationId,mediaId);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,buffer);
  await writeFile(`${filename}.format`,'carousel-landscape-v1');
  return {mediaId,previewUrl:`/api/campaigns/carousel/media/${mediaId}`};
}
export async function carouselImagePath(organizationId: string,id: string){const filename=mediaPath(organizationId,id);await access(filename);return filename;}

const refreshed=new Map<string,{id:string;at:number}>();
export async function refreshCarouselImages(organizationId:string,components:unknown[]) {
  if(!components.some(component=>component&&typeof component==='object'&&(component as any).type==='carousel'))return components;
  const result=structuredClone(components) as any[];
  for(const carousel of result.filter(component=>component?.type==='carousel')) {
    for(const card of carousel.cards||[])for(const header of card.components||[]) {
      const image=header.type==='header'?header.parameters?.[0]?.image:null;if(!image?.id)continue;
      const key=`${organizationId}:${image.id}`;const cached=refreshed.get(key);
      if(cached&&Date.now()-cached.at<24*86400000){image.id=cached.id;continue;}
      const filename=await carouselImagePath(organizationId,String(image.id));
      let prepared=false;try{prepared=(await readFile(`${filename}.format`,'utf8'))==='carousel-landscape-v1';}catch{}
      if(prepared&&Date.now()-(await stat(filename)).mtimeMs<24*86400000){refreshed.set(key,{id:image.id,at:Date.now()});continue;}
      const upload=await storeCarouselImage(organizationId,await readFile(filename),prepared);refreshed.set(key,{id:upload.mediaId,at:Date.now()});image.id=upload.mediaId;
    }
  }
  if(refreshed.size>2000)refreshed.clear();
  return result;
}
