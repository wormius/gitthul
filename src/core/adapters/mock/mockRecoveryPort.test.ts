import { expect, it } from 'vitest';
import { createMockRecoveryPort } from './mockRecoveryPort';

it('una vista previa protege la copia hasta cancelar, sin tocar archivos reales', async () => {
  const port = createMockRecoveryPort({
    directory: '/mock/recovery',
    totalBytes: 10,
    checkpoints: [
      {
        id: 'point',
        repository: '/mock/repo',
        createdAt: 1000,
        label: '',
        status: 'pending',
        fileCount: 1,
        bytes: 10,
        active: false,
      },
    ],
  });
  const preview = await port.preview('point');
  await expect(port.remove('point')).rejects.toMatchObject({ code: 'recovery.protected' });
  await port.cancelPreview(preview.token);
  await expect(port.restore(preview.token)).rejects.toMatchObject({ code: 'recovery.stale' });
  await port.remove('point');
  expect((await port.read()).checkpoints).toHaveLength(0);
  expect((await port.read()).totalBytes).toBe(0);
});
