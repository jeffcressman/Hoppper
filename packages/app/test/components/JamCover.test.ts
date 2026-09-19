import { describe, it, expect, afterEach } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { jamImageUrl } from '@hoppper/sdk';
import JamCover from '../../src/components/JamCover.vue';
import { jamCover } from '../../src/ui/jam-cover';
import { forgetMissingJamImages } from '../../src/ui/jam-image';

enableAutoUnmount(afterEach);
afterEach(() => forgetMissingJamImages());

describe('JamCover', () => {
  it('shows the jam’s Endlesss image', () => {
    const img = mount(JamCover, { props: { jamId: 'band1' } }).find('img');
    expect(img.attributes('src')).toBe(jamImageUrl('band1'));
    // Decorative: the jam's name always sits beside it.
    expect(img.attributes('alt')).toBe('');
  });

  it('keeps the generated cover underneath, so there’s something before the image arrives', () => {
    const cover = mount(JamCover, { props: { jamId: 'band1' } });
    expect(cover.attributes('style')).toContain(`--jam-cover: ${jamCover('band1')}`);
  });

  it('fades the image in once it has loaded', async () => {
    const cover = mount(JamCover, { props: { jamId: 'band1' } });
    expect(cover.find('img').classes()).not.toContain('is-loaded');
    await cover.find('img').trigger('load');
    expect(cover.find('img').classes()).toContain('is-loaded');
  });

  it('falls back to the generated cover for a jam with no image', async () => {
    const cover = mount(JamCover, { props: { jamId: 'band1' } });
    await cover.find('img').trigger('error');
    expect(cover.find('img').exists()).toBe(false);
    expect(cover.attributes('style')).toContain('--jam-cover: linear-gradient');
  });

  it('doesn’t ask the CDN again for an image it has already been refused', async () => {
    await mount(JamCover, { props: { jamId: 'band1' } }).find('img').trigger('error');
    expect(mount(JamCover, { props: { jamId: 'band1' } }).find('img').exists()).toBe(false);
    expect(mount(JamCover, { props: { jamId: 'band2' } }).find('img').exists()).toBe(true);
  });

  it('follows a change of jam', async () => {
    const cover = mount(JamCover, { props: { jamId: 'band1' } });
    await cover.find('img').trigger('load');
    await cover.setProps({ jamId: 'band2' });
    await nextTick();
    expect(cover.find('img').attributes('src')).toBe(jamImageUrl('band2'));
    expect(cover.find('img').classes()).not.toContain('is-loaded');
  });
});
