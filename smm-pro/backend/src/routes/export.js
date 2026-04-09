const router = require('express').Router();
const ExcelJS = require('exceljs');
const { Post } = require('../models');
const { protect } = require('../middleware/auth');

router.get('/bulk-post/:id', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('targetAccounts.account', 'label platform platformUsername');

    if (!post) return res.status(404).json({ message: 'Post tidak ditemukan' });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SMM Pro';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Laporan Bulk Post');

    // Header info
    sheet.mergeCells('A1:F1');
    sheet.getCell('A1').value = 'LAPORAN BULK POST — SMM PRO';
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF534AB7' } };
    sheet.getCell('A1').alignment = { horizontal: 'center' };

    sheet.mergeCells('A2:F2');
    sheet.getCell('A2').value = `Caption: ${post.caption?.slice(0, 100)}${post.caption?.length > 100 ? '...' : ''}`;
    sheet.getCell('A2').font = { italic: true, size: 11 };
    sheet.getCell('A2').alignment = { horizontal: 'center' };

    sheet.mergeCells('A3:F3');
    sheet.getCell('A3').value = `Tanggal Post: ${new Date(post.createdAt).toLocaleString('id-ID')} | Status: ${post.status}`;
    sheet.getCell('A3').font = { size: 10, color: { argb: 'FF888888' } };
    sheet.getCell('A3').alignment = { horizontal: 'center' };

    sheet.addRow([]); // spacer

    // Header kolom
    const headerRow = sheet.addRow(['No', 'Platform', 'Nama Akun', 'Tanggal & Waktu Upload', 'Status', 'Link Post']);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF534AB7' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });

    // Set lebar kolom
    sheet.getColumn(1).width = 6;   // No
    sheet.getColumn(2).width = 14;  // Platform
    sheet.getColumn(3).width = 30;  // Nama Akun
    sheet.getColumn(4).width = 24;  // Tanggal
    sheet.getColumn(5).width = 12;  // Status
    sheet.getColumn(6).width = 50;  // Link

    // Warna per platform
    const platformColors = {
      facebook: 'FFE6F1FB',
      instagram: 'FFFBEAF0',
      youtube: 'FFFAECE7',
      twitter: 'FFF1EFE8',
      tiktok: 'FFEAF3DE',
      threads: 'FFF0EFEC',
    };

    const statusColors = {
      sent: 'FFEAF3DE',
      failed: 'FFFCEBEB',
      pending: 'FFFAEEDA',
    };

    // Data per akun
    let no = 1;
    for (const ta of post.targetAccounts) {
      const platform = ta.account?.platform || '-';
      const label = ta.account?.label || ta.account?.platformUsername || '-';
      const sentAt = ta.sentAt ? new Date(ta.sentAt).toLocaleString('id-ID') : 
                     new Date(post.createdAt).toLocaleString('id-ID');
      const status = ta.status === 'sent' ? '✓ Terkirim' : 
                     ta.status === 'failed' ? '✗ Gagal' : '⟳ Pending';

      // Buat link post
      let link = '-';
      if (ta.platformPostId && ta.status === 'sent') {
        switch (platform) {
          case 'facebook': link = `https://facebook.com/${ta.platformPostId}`; break;
          case 'instagram': link = `https://instagram.com/p/${ta.platformPostId}`; break;
          case 'youtube': link = `https://youtube.com/watch?v=${ta.platformPostId}`; break;
          case 'twitter': link = `https://twitter.com/i/web/status/${ta.platformPostId}`; break;
          case 'threads': link = `https://threads.net/t/${ta.platformPostId}`; break;
          default: link = ta.platformPostId || '-';
        }
      }

      const row = sheet.addRow([no++, platform.toUpperCase(), label, sentAt, status, link]);

      // Warna background per platform
      const bgColor = platformColors[platform] || 'FFFFFFFF';
      const statusBg = statusColors[ta.status] || 'FFFFFFFF';

      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F4F2' } };
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusBg } };
      row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

      // Link sebagai hyperlink
      if (link !== '-') {
        row.getCell(6).value = { text: link, hyperlink: link };
        row.getCell(6).font = { color: { argb: 'FF185FA5' }, underline: true };
      }

      // Border semua cell
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };
        cell.alignment = { vertical: 'middle', wrapText: false };
      });

      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
      row.height = 20;
    }

    // Summary row
    sheet.addRow([]);
    const totalSent = post.targetAccounts.filter(t => t.status === 'sent').length;
    const totalFailed = post.targetAccounts.filter(t => t.status === 'failed').length;
    const summaryRow = sheet.addRow(['', '', `Total: ${post.targetAccounts.length} akun`, '', `✓ ${totalSent} berhasil  ✗ ${totalFailed} gagal`, '']);
    summaryRow.getCell(3).font = { bold: true };
    summaryRow.getCell(5).font = { bold: true };

    // Freeze header
    sheet.views = [{ state: 'frozen', ySplit: 5 }];

    // Auto filter
    sheet.autoFilter = { from: 'A5', to: 'F5' };

    // Set filename
    const date = new Date(post.createdAt).toLocaleDateString('id-ID').replace(/\//g, '-');
    const filename = `Laporan_BulkPost_${date}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Export semua post dalam rentang tanggal
router.get('/bulk-post', protect, async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { createdBy: req.user._id };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const posts = await Post.find(filter)
      .populate('targetAccounts.account', 'label platform platformUsername')
      .sort('-createdAt')
      .limit(100);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SMM Pro';

    const sheet = workbook.addWorksheet('Semua Laporan Bulk Post');

    // Header
    sheet.mergeCells('A1:G1');
    sheet.getCell('A1').value = 'LAPORAN SEMUA BULK POST — SMM PRO';
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF534AB7' } };
    sheet.getCell('A1').alignment = { horizontal: 'center' };

    sheet.addRow([]);

    const headerRow = sheet.addRow(['No', 'Platform', 'Nama Akun', 'Caption', 'Tanggal & Waktu', 'Status', 'Link Post']);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF534AB7' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 14;
    sheet.getColumn(3).width = 28;
    sheet.getColumn(4).width = 35;
    sheet.getColumn(5).width = 22;
    sheet.getColumn(6).width = 12;
    sheet.getColumn(7).width = 45;

    let no = 1;
    for (const post of posts) {
      const caption = post.caption?.slice(0, 50) + (post.caption?.length > 50 ? '...' : '');
      for (const ta of post.targetAccounts) {
        const platform = ta.account?.platform || '-';
        const label = ta.account?.label || '-';
        const sentAt = ta.sentAt ? new Date(ta.sentAt).toLocaleString('id-ID') :
                       new Date(post.createdAt).toLocaleString('id-ID');
        const status = ta.status === 'sent' ? '✓ Terkirim' : ta.status === 'failed' ? '✗ Gagal' : '⟳ Pending';

        let link = '-';
        if (ta.platformPostId && ta.status === 'sent') {
          switch (platform) {
            case 'facebook': link = `https://facebook.com/${ta.platformPostId}`; break;
            case 'instagram': link = `https://instagram.com/p/${ta.platformPostId}`; break;
            case 'youtube': link = `https://youtube.com/watch?v=${ta.platformPostId}`; break;
            case 'twitter': link = `https://twitter.com/i/web/status/${ta.platformPostId}`; break;
            default: link = ta.platformPostId || '-';
          }
        }

        const row = sheet.addRow([no++, platform.toUpperCase(), label, caption, sentAt, status, link]);

        if (link !== '-') {
          row.getCell(7).value = { text: link, hyperlink: link };
          row.getCell(7).font = { color: { argb: 'FF185FA5' }, underline: true };
        }

        row.eachCell(cell => {
          cell.border = { top: { style: 'thin', color: { argb: 'FFE0E0E0' } }, bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } }, left: { style: 'thin', color: { argb: 'FFE0E0E0' } }, right: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
          cell.alignment = { vertical: 'middle' };
        });
        row.height = 20;
      }
    }

    sheet.views = [{ state: 'frozen', ySplit: 3 }];
    sheet.autoFilter = { from: 'A3', to: 'G3' };

    const filename = `Laporan_BulkPost_Semua_${new Date().toLocaleDateString('id-ID').replace(/\//g, '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
