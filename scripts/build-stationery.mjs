// Original procedural paper fibers, not a photographed or generated image.
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
const size = 256, png = new PNG({width:size,height:size});
let seed=9137;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const grain=Array.from({length:size*size},()=>random());
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4;
  const fiber=grain[y*size+x]*.5+grain[y*size+(x+1)%size]*.25+grain[y*size+(x+2)%size]*.25;
  const d=(fiber-.5)*7;
  png.data[i]=249+d;png.data[i+1]=242+d;png.data[i+2]=226+d;png.data[i+3]=255;
}
for(let k=0;k<1000;k++){
  const x=random()*size|0,y=random()*size|0,length=2+(random()*6|0),light=random()>.5;
  for(let j=0;j<length;j++){
    const i=((y*size+(x+j)%size)*4);const d=light?2:-2;
    for(let c=0;c<3;c++)png.data[i+c]=Math.min(255,Math.max(0,png.data[i+c]+d));
  }
}
writeFileSync('public/textiles/ivory-writing-paper.png',PNG.sync.write(png));
