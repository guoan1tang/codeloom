package com.acme.naming.entity;

/** No @TableName: MyBatis-Plus derives "order" from the class name (suffix dropped). */
public class OrderEntity {
    private Long id;
    private Boolean deleted;

    public Long getId() { return id; }
    public Boolean getDeleted() { return deleted; }
}