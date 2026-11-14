package com.acme.roster.entity;

import com.baomidou.mybatisplus.annotation.TableName;

@TableName(value = "company_dept")
public class CompanyDept {
    private Long id;
    private Long companyId;
    private String deptPath;

    public Long getId() { return id; }
    public Long getCompanyId() { return companyId; }
    public String getDeptPath() { return deptPath; }
}