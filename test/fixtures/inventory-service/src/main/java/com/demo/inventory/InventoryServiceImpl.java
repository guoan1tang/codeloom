package com.demo.inventory;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class InventoryServiceImpl implements InventoryService {
    @Autowired
    private StockRepository stockRepository;
    @Autowired
    private MqProducer mqProducer;

    public void deductStock(String skuId, Integer quantity) {
        stockRepository.decrement(skuId, quantity);
        if (quantity > 10) {
            mqProducer.send("stock-low", skuId);
        }
    }
}