package com.acme.roster;

import com.acme.roster.entity.CompanyDept;
import com.acme.roster.registry.CompanyDeptRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Deliberate same-name collision with UserShopCorrelationManager.expandDeptToShopIds,
 * mirroring the real customer-service pair that caused a false table attribution.
 */
@Service
public class ShopGroupJobService {
    @Autowired
    private CompanyDeptRegistry companyDeptRegistry;

    private List<Long> expandDeptToShopIds(Long companyId, List<Long> deptIds) {
        return companyDeptRegistry.lambdaQuery()
                .eq(CompanyDept::getCompanyId, companyId)
                .in(CompanyDept::getId, deptIds)
                .list().stream().map(CompanyDept::getId).collect(Collectors.toList());
    }
}