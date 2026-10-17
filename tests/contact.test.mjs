import test from 'node:test'
import assert from 'node:assert/strict'
import { productInquiry, shopContact } from '../dashboard/shared/contact.js'
test('Viber and call targets use the configured shop number normalized to international format', () => {
  const contact = shopContact('09666655928')
  assert.equal(contact.viber, 'viber://chat?number=%2B959666655928')
  assert.equal(contact.call, 'tel:+959666655928')
  assert.equal(shopContact('+95 9 666655928').viber, contact.viber)
  assert.equal(shopContact('၀၉၆၆၆၆၅၅၉၂၈').viber, contact.viber)
  for (const phone of ['', 'bad', 'javascript:alert(1)', '123']) assert.equal(shopContact(phone), null)
})
test('copyable inquiry contains only the selected product/color/size and no customer data', () => {
  assert.equal(productInquiry({ name: 'Dress' }, 'Black', 'S'), 'Dress\nColor: Black\nSize: S')
  assert.equal(productInquiry({ name: 'Dress' }, '', ''), 'Dress')
})
