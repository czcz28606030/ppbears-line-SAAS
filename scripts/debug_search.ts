import dotenv from 'dotenv';
dotenv.config({ path: 'packages/backend/.env' });
import { productService } from './packages/backend/src/modules/products/product.service';

async function run() {
  const res = await productService.searchProducts('f3a9e1e9-4670-4966-adc6-ea78d46e27ab', '小米17', 5);
  console.log("Search results for 小米17:", JSON.stringify(res, null, 2));
}

run().catch(console.error);
