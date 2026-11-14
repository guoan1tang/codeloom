package com.acme.orm.repo;

import com.acme.orm.entity.ProductEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface JpaProductRepository extends JpaRepository<ProductEntity, String> {

    @Query("select count(1) from t_product_audit where status = ?1")
    long countAudit(Integer status);
}
