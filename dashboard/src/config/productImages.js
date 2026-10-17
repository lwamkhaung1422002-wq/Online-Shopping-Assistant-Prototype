import elegenceBrown01 from '../assets/products/elegence/elegence-brown-01.webp'
import elegenceBrown02 from '../assets/products/elegence/elegence-brown-02.webp'
import elegenceBlack01 from '../assets/products/elegence/elegence-black-01.webp'
import elegenceBlack02 from '../assets/products/elegence/elegence-black-02.webp'
import elegenceBrown03 from '../assets/products/elegence/elegence-brown-03.webp'
import elegenceBlack03 from '../assets/products/elegence/elegence-black-03.webp'
import shortRed01 from '../assets/products/elegence-short/elegence-short-red-01.webp'
import shortBlack01 from '../assets/products/elegence-short/elegence-short-black-01.webp'
import shortPink01 from '../assets/products/elegence-short/elegence-short-pink-01.webp'
import shortRed02 from '../assets/products/elegence-short/elegence-short-red-02.webp'
import shortPink02 from '../assets/products/elegence-short/elegence-short-pink-02.webp'
import shortPink03 from '../assets/products/elegence-short/elegence-short-pink-03.webp'
import lovieBlack01 from '../assets/products/lovie-floral/lovie-floral-black-01.webp'
import lovieBlue01 from '../assets/products/lovie-floral/lovie-floral-blue-01.webp'
import lovieBlack02 from '../assets/products/lovie-floral/lovie-floral-black-02.webp'
import lovieRed01 from '../assets/products/lovie-floral/lovie-floral-red-01.webp'
import lovieRed02 from '../assets/products/lovie-floral/lovie-floral-red-02.webp'
import lovieBlue02 from '../assets/products/lovie-floral/lovie-floral-blue-02.webp'
import sakuraMatcha from '../assets/products/sakura/sakura-matcha.webp'
import sakuraCherry from '../assets/products/sakura/sakura-cherry.webp'
import sakuraNude from '../assets/products/sakura/sakura-nude.webp'
import sakuraColors01 from '../assets/products/sakura/sakura-colors-01.webp'
import sakuraColors02 from '../assets/products/sakura/sakura-colors-02.jpg'
import sakuraColors03 from '../assets/products/sakura/sakura-colors-03.png'

const image = (id, src, color) => ({ id, src, color })

export const productImages = {
  elegence: [
    image('brown-01', elegenceBrown01, 'Brown'),
    image('brown-02', elegenceBrown02, 'Brown'),
    image('black-01', elegenceBlack01, 'Black'),
    image('black-02', elegenceBlack02, 'Black'),
    image('brown-03', elegenceBrown03, 'Brown'),
    image('black-03', elegenceBlack03, 'Black'),
  ],
  'elegence-short': [
    image('red-01', shortRed01, 'Red'),
    image('black-01', shortBlack01, 'Black'),
    image('pink-01', shortPink01, 'Pink'),
    image('red-02', shortRed02, 'Red'),
    image('pink-02', shortPink02, 'Pink'),
    image('pink-03', shortPink03, 'Pink'),
  ],
  sakura: [
    image('matcha', sakuraMatcha, 'Matcha'),
    image('cherry', sakuraCherry, 'Cherry'),
    image('nude', sakuraNude, 'Nude'),
    image('colors-01', sakuraColors01, 'All colors'),
    image('colors-02', sakuraColors02, 'Color collection'),
    image('colors-03', sakuraColors03, 'Cherry · Nude · Matcha'),
  ],
  'lovi-floral': [
    image('black-01', lovieBlack01, 'Black floral'),
    image('blue-01', lovieBlue01, 'Blue floral'),
    image('black-02', lovieBlack02, 'Black floral'),
    image('red-01', lovieRed01, 'Red floral'),
    image('red-02', lovieRed02, 'Red floral'),
    image('blue-02', lovieBlue02, 'Blue floral'),
  ],
}

export function getProductImages(productId) {
  return productImages[productId] ?? null
}
