package com.demo.order.repo;

import com.demo.order.entity.OrderEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface JpaOrderRepository extends JpaRepository<OrderEntity, String> {

    @Query("select count(1) from t_jpa_order where status = ?1")
    long countByStatus(Integer status);
}
