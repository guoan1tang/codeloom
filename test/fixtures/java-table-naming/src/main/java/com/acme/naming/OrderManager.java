package com.acme.naming;

import com.acme.naming.entity.OrderEntity;
import com.acme.naming.registry.OrderRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class OrderManager {
    @Autowired
    private OrderRegistry orderRegistry;

    /** Fluent chain: only the head receiver (orderRegistry) is resolvable. */
    public List<OrderEntity> listAll() {
        return orderRegistry.lambdaQuery()
                .eq(OrderEntity::getDeleted, false)
                .list();
    }

    public long count() {
        return orderRegistry.count();
    }

    public void save(OrderEntity entity) {
        orderRegistry.save(entity);
    }

    public void update(OrderEntity entity) {
        orderRegistry.updateById(entity);
    }

    public void remove(Long id) {
        orderRegistry.removeById(id);
    }
}