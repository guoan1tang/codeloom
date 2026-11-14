package com.acme.roster.entity;

/**
 * Bare class name, no suffix, no annotation — the real customer-service case.
 * The @TableName below is only a Javadoc mention and must NOT be parsed as one.
 *
 * @TableName shop_group
 */
public class ShopGroup {
    private Long id;
    private Long shopId;
    private Boolean deleted;

    public Long getId() { return id; }
    public Long getShopId() { return shopId; }
    public Boolean getDeleted() { return deleted; }
}