package com.acme.roster.entity;

/** Bare class name: MyBatis-Plus convention maps it to "shop_info". */
public class ShopInfo {
    private Long id;
    private Long deptId;
    private Integer status;

    public Long getId() { return id; }
    public Long getDeptId() { return deptId; }
    public Integer getStatus() { return status; }
}