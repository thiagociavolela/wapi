import {beforeEach,describe,it,expect,vi} from 'vitest';
const {execute}=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('mysql2/promise',()=>({default:{createPool:()=>({execute})}}));
vi.mock('../../config.js',()=>({config:{PRODUCT_DB_HOST:'host',PRODUCT_DB_PORT:3306,PRODUCT_DB_USER:'user',PRODUCT_DB_NAME:'products',PRODUCT_IMAGE_BASE_URL:'https://store.example'},MYSQL_TIME_ZONE:'-03:00'}));
import {searchProducts} from './service.js';
beforeEach(()=>execute.mockReset());
describe('product lookup',()=>{
  it('prioritizes an exact ID and restricts the carousel to active products',async()=>{
    execute.mockResolvedValueOnce([[{id:587,nome:'Lipo Star',preco:'190',status:0,imagem:'/star.webp',slug:'lipo-star'}],[]]);
    const results=await searchProducts('587',true);
    expect(results[0]).toMatchObject({id:587,active:true,imageUrl:'https://store.example/star.webp'});
    expect(execute.mock.calls[0][0]).toContain('AND status = 0');
    expect(execute.mock.calls[0][1]).toEqual([587,'%587%','%587%','%587%',587]);
  });
  it('searches names, descriptions and slugs with literal wildcard characters',async()=>{
    execute.mockResolvedValueOnce([[],[]]);await searchProducts('Lipo_%');
    expect(execute.mock.calls[0][0]).toContain('desc_curta LIKE ? OR slug LIKE ?');
    expect(execute.mock.calls[0][1]).toEqual(['%Lipo\\_\\%%','%Lipo\\_\\%%','%Lipo\\_\\%%']);
    expect(execute.mock.calls[0][0]).not.toContain('AND status = 0');
  });
  it('does not query the database for empty search',async()=>{
    expect(await searchProducts('  ')).toEqual([]);expect(execute).not.toHaveBeenCalled();
  });
});
