package com.acme.roster.entity;

/** Bare class name: MyBatis-Plus convention maps it to "user_permission". */
public class UserPermission {
    private Long id;
    private Long userId;
    private Long correlationId;

    public Long getId() { return id; }
    public Long getUserId() { return userId; }
    public Long getCorrelationId() { return correlationId; }
}