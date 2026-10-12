import {it,expect,vi} from 'vitest';
vi.mock('../../database/pool.js',()=>({pool:{execute:vi.fn()}}));
import {pool} from '../../database/pool.js';
import {deleteCompletedCampaign} from './service.js';
it('deletes only completed campaigns in the current organization',async()=>{
  const execute=vi.mocked(pool.execute);execute.mockResolvedValueOnce([{affectedRows:1},[]] as any);
  expect(await deleteCompletedCampaign('org','campaign')).toBe(true);
  expect(execute.mock.calls[0]).toEqual(["DELETE FROM campaigns WHERE id=? AND organization_id=? AND status='completed'",['campaign','org']]);
  execute.mockResolvedValueOnce([{affectedRows:0},[]] as any);
  expect(await deleteCompletedCampaign('org','running-or-foreign')).toBe(false);
});
