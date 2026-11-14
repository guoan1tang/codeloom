package com.acme.naming.entity;

/** No @TableName: convention yields "user_permission". */
public class UserPermissionEntity {
    private Long id;
    private Long userId;

    public Long getId() { return id; }
    public Long getUserId() { return userId; }
}