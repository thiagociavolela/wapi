import { describe,it,expect,vi,beforeEach } from 'vitest';
vi.mock('../../database/pool.js',()=>({pool:{execute:vi.fn()}}));
import { pool } from '../../database/pool.js';
import { campaignDashboard,campaignReport,campaignExport,csvCell } from './dashboard.js';
const execute=vi.mocked(pool.execute);
beforeEach(()=>execute.mockReset());
describe('campaign dashboard reads',()=>{
  it('clamps page to available history and limits recipients aggregation to that page',async()=>{
    execute.mockResolvedValueOnce([[{total:21}],[]] as any).mockResolvedValueOnce([[],[]] as any).mockResolvedValueOnce([[{total:0}],[]] as any).mockResolvedValueOnce([[],[]] as any);
    const result=await campaignDashboard('org',{page:99,status:'completed',search:'offer'});
    expect(result.page).toBe(2);expect(result.pages).toBe(2);
    expect(execute.mock.calls[1][0]).toContain('LIMIT 20 OFFSET 20');
    expect(execute.mock.calls[1][1]).toEqual(['org','%offer%','%offer%','completed']);
    expect(execute.mock.calls[2][0]).toContain("r.status IN ('delivered','read')");
  });
  it('does not read recipients when the organization cannot access the campaign',async()=>{
    execute.mockResolvedValueOnce([[],[]] as any);
    expect(await campaignReport('org','foreign',{})).toBeNull();expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toEqual(['org','foreign']);
  });
  it('paginates all recipients and includes reads in the delivered filter',async()=>{
    execute.mockResolvedValueOnce([[{id:'id'}],[]] as any).mockResolvedValueOnce([[{total:501}],[]] as any).mockResolvedValueOnce([[],[]] as any).mockResolvedValueOnce([[],[]] as any);
    const result=await campaignReport('org','id',{page:11,status:'delivered'});
    expect(result?.pages).toBe(11);expect(execute.mock.calls[2][0]).toContain('LIMIT 50 OFFSET 500');
    expect(execute.mock.calls[2][0]).toContain("status IN ('delivered','read')");
    expect(execute.mock.calls[2][1]).toEqual(['org','id']);
  });
  it('exports only failures when requested and scopes both tables to organization',async()=>{
    execute.mockResolvedValueOnce([[],[]] as any);await campaignExport('org','id',true);
    expect(execute.mock.calls[0][0]).toContain("r.status='failed'");expect(execute.mock.calls[0][1]).toEqual(['org','org','id']);
  });
});
it('escapes CSV quotes and neutralizes spreadsheet formulas',()=>{
  expect(csvCell('a"b')).toBe('"a""b"');expect(csvCell('=1+1')).toBe('"\'=1+1"');expect(csvCell(null)).toBe('""');
});
