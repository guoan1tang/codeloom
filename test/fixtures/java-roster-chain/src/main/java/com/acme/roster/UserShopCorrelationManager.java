package com.acme.roster;

import com.acme.roster.entity.CompanyDept;
import com.acme.roster.entity.ShopInfo;
import com.acme.roster.registry.CompanyDeptRegistry;
import com.acme.roster.registry.ShopInfoRegistry;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

@Component
public class UserShopCorrelationManager {
    @Autowired
    private CompanyDeptRegistry companyDeptRegistry;
    @Autowired
    private ShopInfoRegistry shopInfoRegistry;

    /** Reads company_dept and shop_info — both via the generic utility. */
    public List<Long> expandDeptToShopIds(List<Long> deptIds) {
        List<CompanyDept> depts = PaginationUtils.queryAllWithPagination(companyDeptRegistry,
                Wrappers.<CompanyDept>lambdaQuery().in(CompanyDept::getId, deptIds));
        List<Long> allDeptIds = depts.stream().map(CompanyDept::getId).collect(Collectors.toList());
        return PaginationUtils.queryAllWithPagination(shopInfoRegistry,
                Wrappers.<ShopInfo>lambdaQuery().in(ShopInfo::getDeptId, allDeptIds))
                .stream().map(ShopInfo::getId).distinct().collect(Collectors.toList());
    }
}