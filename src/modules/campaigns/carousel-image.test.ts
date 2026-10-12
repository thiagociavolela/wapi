import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {convertProductImageToJpeg} from '../products/service.js';
const require=createRequire(import.meta.url);
const ffmpeg=require('ffmpeg-static') as string;
function run(args:string[],input:Buffer){
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{input,maxBuffer:10*1024*1024,windowsHide:true});
  if(result.status!==0)throw new Error(result.stderr.toString());return result.stdout;
}
function picture(width:number,height:number,transparent=false){
  const channels=transparent?4:3;const pixels=Buffer.alloc(width*height*channels);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*channels;
    const position=width>height?x/width:y/height;
    pixels[offset+(position<1/3?0:position<2/3?1:2)]=255;
    if(transparent)pixels[offset+3]=x>width/4&&x<width*3/4&&y>height/4&&y<height*3/4?255:0;
  }
  return run(['-f','rawvideo','-pixel_format',transparent?'rgba':'rgb24','-video_size',`${width}x${height}`,'-i','pipe:0','-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],pixels);
}
function decode(image:Buffer){return run(['-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],image);}
function pixel(buffer:Buffer,x:number,y:number){return [...buffer.subarray((y*1200+x)*3,(y*1200+x)*3+3)];}
describe('carousel image framing',()=>{
  it('keeps the top and bottom of portrait images with white safety margins',async()=>{
    const output=decode(await convertProductImageToJpeg(picture(200,800),true));
    expect(output.length).toBe(1200*630*3);
    expect(pixel(output,600,90)[0]).toBeGreaterThan(240);
    expect(pixel(output,600,315)[1]).toBeGreaterThan(240);
    expect(pixel(output,600,540)[2]).toBeGreaterThan(240);
    expect(pixel(output,600,20).every(value=>value>245)).toBe(true);
  },15000);
  it('keeps both ends of wide images and composites transparency over white',async()=>{
    const wide=decode(await convertProductImageToJpeg(picture(1600,200),true));
    expect(pixel(wide,90,315)[0]).toBeGreaterThan(240);
    expect(pixel(wide,1110,315)[2]).toBeGreaterThan(240);
    const alpha=decode(await convertProductImageToJpeg(picture(200,200,true),true));
    expect(pixel(alpha,380,90).every(value=>value>245)).toBe(true);
  },15000);
  it('preserves the existing conversion size for ordinary product messages',async()=>{
    expect(decode(await convertProductImageToJpeg(picture(200,800))).length).toBe(200*800*3);
  },15000);
});
