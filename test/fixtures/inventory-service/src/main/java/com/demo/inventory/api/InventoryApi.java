package com.demo.inventory.api;

import io.swagger.annotations.ApiOperation;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;

/** 库存服务对外契约接口 */
@FeignClient(name = "inventory-service")
public interface InventoryApi {

    /**
     * 扣减指定 SKU 的库存数量
     * @param sku 商品编码
     */
    @ApiOperation("扣减库存")
    @PostMapping("/inventory/deduct")
    String deduct(String sku);
}